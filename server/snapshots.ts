/// <reference types="node" />
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { exportBundle } from '../src/data/bundle/exportBundle'
import { onCommand } from '../src/data/events'
import { serializeRead } from './registry'

/**
 * §8 snapshots, server edition: a full bundle is written to the host filesystem
 * when the workspace is dirty — every 5 minutes and immediately after any
 * cascade deletion — pruned to the most recent KEEP. Replaces the browser's
 * OPFS ring + folder mirror.
 */
const DIR = process.env.GNOSIS_SNAPSHOTS ?? './snapshots'
const KEEP = 50
const INTERVAL_MS = 5 * 60_000

let dirty = false
let writing = false

/**
 * Write a full bundle to the snapshot dir, pruned to KEEP. Throws on failure so
 * the §9 pre-import guard can refuse a destructive replace without a copy.
 */
export async function writeSnapshot(): Promise<void> {
  mkdirSync(DIR, { recursive: true })
  const bundle = await serializeRead(() => exportBundle())
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  writeFileSync(join(DIR, `snapshot-${stamp}.json`), JSON.stringify(bundle))
  const snaps = readdirSync(DIR)
    .filter((f) => f.startsWith('snapshot-') && f.endsWith('.json'))
    .sort()
  for (const f of snaps.slice(0, -KEEP)) rmSync(join(DIR, f))
}

async function snapshotTick(): Promise<void> {
  if (writing) return
  writing = true
  dirty = false
  try {
    await writeSnapshot()
  } catch {
    dirty = true // retry on the next tick
  } finally {
    writing = false
  }
}

export function startSnapshots(): void {
  onCommand((event) => {
    dirty = true
    if (event.cascade) void snapshotTick()
  })
  setInterval(() => {
    if (dirty) void snapshotTick()
  }, INTERVAL_MS)
}
