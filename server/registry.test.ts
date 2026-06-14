import { beforeEach, describe, expect, it } from 'vitest'
import { exportBundle } from '../src/data/bundle/exportBundle'
import { freshDb } from '../src/test/helpers'
import { runCommand, serializeRead } from './registry'

beforeEach(async () => {
  await freshDb()
})

describe('registry serializeRead', () => {
  it('observes a write queued before it — never reads mid-write state', async () => {
    const before = (await exportBundle()).nodes.length
    // Queue a write and a read together, awaiting neither first. serializeRead
    // shares the write chain, so the snapshot must run AFTER the create commits
    // (not join the open write txn via SqliteStore's depth guard).
    const write = runCommand('create-node', { title: 'X' })
    const snapshot = serializeRead(() => exportBundle())
    const [, bundle] = await Promise.all([write, snapshot])
    expect(bundle.nodes.length).toBe(before + 1)
  })
})
