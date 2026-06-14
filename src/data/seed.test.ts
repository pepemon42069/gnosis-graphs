import { describe, expect, it } from 'vitest'
import { freshDb } from '../test/helpers'
import { getMeta } from './db'
import { seedWorkspace } from './seed'

describe('seeding', () => {
  it('creates root graph, Home, vocabulary, and the referring node exactly once', async () => {
    const db = await freshDb()
    expect(await db.graphs.count()).toBe(2)
    expect(await db.relationTypes.count()).toBe(6)
    expect(await db.kinds.count()).toBe(5)
    expect(await getMeta<string>(db, 'rootGraphId')).toBeDefined()
    const homeGraphId = await getMeta<string>(db, 'homeGraphId')
    expect(homeGraphId).toBeDefined()
    const pointer = await db.nodes.toCollection().first()
    expect(pointer?.childGraphId).toBe(await getMeta<string>(db, 'rootGraphId'))
    expect((await db.placements.toCollection().first())?.graphId).toBe(homeGraphId)
  })

  it('is idempotent under concurrent calls (StrictMode / racing tabs)', async () => {
    const db = await freshDb()
    await Promise.all([seedWorkspace(db), seedWorkspace(db), seedWorkspace(db)])
    expect(await db.graphs.count()).toBe(2)
    expect(await db.nodes.count()).toBe(1)
    expect(await db.relationTypes.count()).toBe(6)
  })

  it('never re-asserts seeds: user deletions stick', async () => {
    const db = await freshDb()
    const kind = (await db.kinds.toArray())[0]!
    await db.kinds.delete(kind.id)
    await seedWorkspace(db)
    expect(await db.kinds.count()).toBe(4)
  })
})
