import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatch } from '../src/data/commands/dispatcher'
import { createNode } from '../src/data/commands/nodeCommands'
import { freshDb } from '../src/test/helpers'
import { app } from './api'

// A disconnect on /api/events must clear the keep-alive ping timer. The old
// `while (!stream.closed) { await sleep; ping }` loop never cancelled on abort,
// leaking a pending timer per connection.
describe('GET /api/events keep-alive teardown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears the ping timer when the client disconnects (no leaked timer)', async () => {
    const ac = new AbortController()
    const res = await app.fetch(new Request('http://test/api/events', { signal: ac.signal }))
    const reader = res.body!.getReader()

    // The handler has armed its 30s keep-alive interval.
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    // Client disconnects: cancelling the reader aborts the stream → onAbort.
    await reader.cancel()
    // Let the onAbort microtasks settle (clears the interval).
    await vi.advanceTimersByTimeAsync(0)

    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('GET /api/files', () => {
  it('lists workspace files (filename + nodeId), without content', async () => {
    await freshDb()
    const cmd = createNode({ title: 'Doc', file: { filename: 'notes.md', format: 'markdown', content: 'hi' } })
    await dispatch(cmd)

    const res = await app.fetch(new Request('http://test/api/files'))
    expect(res.status).toBe(200)
    const files = (await res.json()) as Array<{ id: string; nodeId: string; filename: string; content?: string }>
    const f = files.find((x) => x.filename === 'notes.md')
    expect(f).toBeTruthy()
    expect(f!.nodeId).toBe(cmd.nodeId)
    expect('content' in f!).toBe(false)
  })
})

// snapshots.ts reads GNOSIS_SNAPSHOTS at module load; set it then re-import the
// whole module graph fresh so /api/reset's pre-reset snapshot lands in a temp dir.
describe('POST /api/reset', () => {
  let snapDir: string

  beforeEach(() => {
    snapDir = mkdtempSync(join(tmpdir(), 'gnosis-snap-'))
    process.env.GNOSIS_SNAPSHOTS = snapDir
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(snapDir, { recursive: true, force: true })
    delete process.env.GNOSIS_SNAPSHOTS
  })

  it('snapshots, clears every table, and re-seeds a clean empty Home', async () => {
    const { app } = await import('./api')
    const { dispatch } = await import('../src/data/commands/dispatcher')
    const { createNode } = await import('../src/data/commands/nodeCommands')
    const { freshDb } = await import('../src/test/helpers')
    const { getMeta } = await import('../src/data/db')

    const db = await freshDb()
    const home = (await getMeta<string>(db, 'homeGraphId'))!
    // Dirty the workspace with extra content beyond the seed.
    await dispatch(
      createNode({
        title: 'Doc',
        file: { filename: 'notes.md', format: 'markdown', content: 'hi' },
        placement: { graphId: home, x: 0, y: 0 },
      }),
    )
    expect(await db.nodes.count()).toBeGreaterThan(1)
    expect(await db.files.count()).toBe(1)

    const res = await app.fetch(new Request('http://test/api/reset', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    // Back to a clean seeded workspace: vocab + root + a fresh Home, no leftovers.
    expect(await db.files.count()).toBe(0)
    expect(await db.graphs.count()).toBe(2) // root "First graph" + "Default" Home
    expect(await db.relationTypes.count()).toBe(6)
    expect(await db.kinds.count()).toBe(5)
    // The fresh Home is a brand-new graph (the dirty content is gone).
    const newHome = await getMeta<string>(db, 'homeGraphId')
    expect(newHome).toBeDefined()
    expect(await db.graphs.get(newHome!)).toBeDefined()
    // Only the seeded Home pointer node survives.
    expect(await db.nodes.count()).toBe(1)
    const pointer = await db.nodes.toCollection().first()
    expect(pointer?.childGraphId).toBe(await getMeta<string>(db, 'rootGraphId'))
  })
})

// §9 data-safety: a failed pre-destructive snapshot must REFUSE the op (500) and
// leave the workspace byte-identical. Force writeSnapshot() to throw by pointing
// GNOSIS_SNAPSHOTS under a regular file so mkdirSync fails (ENOTDIR).
describe('destructive ops refuse on snapshot failure', () => {
  let badRoot: string

  beforeEach(() => {
    badRoot = mkdtempSync(join(tmpdir(), 'gnosis-snap-'))
    const asFile = join(badRoot, 'not-a-dir')
    writeFileSync(asFile, 'x')
    process.env.GNOSIS_SNAPSHOTS = join(asFile, 'snapshots')
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(badRoot, { recursive: true, force: true })
    delete process.env.GNOSIS_SNAPSHOTS
  })

  it('POST /api/reset refuses and leaves the workspace unchanged', async () => {
    const { app } = await import('./api')
    const { freshDb, dumpAll } = await import('../src/test/helpers')
    const db = await freshDb()
    const before = await dumpAll(db)

    const res = await app.fetch(new Request('http://test/api/reset', { method: 'POST' }))
    expect(res.status).toBe(500)
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false)
    expect(await dumpAll(db)).toEqual(before)
  })

  it('POST /api/import refuses and leaves the workspace unchanged', async () => {
    const { app } = await import('./api')
    const { freshDb, dumpAll } = await import('../src/test/helpers')
    const db = await freshDb()
    const before = await dumpAll(db)

    const res = await app.fetch(
      new Request('http://test/api/import', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(500)
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false)
    expect(await dumpAll(db)).toEqual(before)
  })

  it('POST /api/graph/:id/source refuses a destructive apply and leaves the graph unchanged', async () => {
    const { app } = await import('./api')
    const { freshDb, dumpAll } = await import('../src/test/helpers')
    const { dispatch } = await import('../src/data/commands/dispatcher')
    const { createNode } = await import('../src/data/commands/nodeCommands')
    const { getMeta } = await import('../src/data/db')
    const db = await freshDb()
    const graphId = (await getMeta<string>(db, 'rootGraphId'))!
    await dispatch(createNode({ title: 'X', placement: { graphId, x: 0, y: 0 } }))
    const before = await dumpAll(db)

    // Empty source omits the placed node → a destructive removal → snapshot first.
    const res = await app.fetch(
      new Request(`http://test/api/graph/${graphId}/source`, {
        method: 'POST',
        body: JSON.stringify({ source: '' }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(500)
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false)
    expect(await dumpAll(db)).toEqual(before)
  })
})
