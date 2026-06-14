/// <reference types="node" />
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDb } from '../src/data/db'
import { onCommand } from '../src/data/events'
import { extFor } from '../src/data/files/extFor'
import { slug } from '../src/data/files/slug'

/**
 * D1 FS mirror: a one-way write-through projection of the DB files table to the
 * host filesystem so external tools can READ them. On boot and after any command
 * that touches files, a debounced full reconcile writes every file under a stable
 * `<slug>-<shortId>.<ext>` name and prunes anything no longer in the DB.
 */
const DIR = process.env.GNOSIS_FILES ?? './files'
const DEBOUNCE_MS = 250

let timer: ReturnType<typeof setTimeout> | null = null

function nameFor(filename: string, format: string, language: string | undefined, id: string): string {
  const dot = filename.lastIndexOf('.')
  const stem = dot > 0 ? filename.slice(0, dot) : filename
  const ext = dot > 0 ? filename.slice(dot + 1) : extFor(format as never, language)
  return `${slug(stem, 'file')}-${id.slice(0, 8)}.${ext}`
}

export async function reconcile(): Promise<void> {
  mkdirSync(DIR, { recursive: true })
  const files = await getDb().files.toArray()
  const kept = new Set<string>()
  for (const file of files) {
    const name = nameFor(file.filename, file.format, file.language, file.id)
    kept.add(name)
    writeFileSync(join(DIR, name), file.content)
  }
  for (const f of readdirSync(DIR)) {
    // recursive: a stray sub-directory must not abort the prune; force: swallow
    // ENOENT races so one bad entry never wedges subsequent reconciles.
    if (!kept.has(f)) rmSync(join(DIR, f), { recursive: true, force: true })
  }
}

export function startFileMirror(): void {
  void reconcile()
  onCommand((event) => {
    if (!event.events.some((e) => e.type === 'files-changed')) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void reconcile(), DEBOUNCE_MS)
  })
}
