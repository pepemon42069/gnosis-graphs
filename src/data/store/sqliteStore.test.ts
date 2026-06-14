import { beforeEach, describe, expect, it } from 'vitest'
import { type GnosisDB } from '../db'
import { freshDb } from '../../test/helpers'

let db: GnosisDB

beforeEach(async () => {
  db = await freshDb()
})

const placement = (id: string, graphId: string, nodeId: string) => ({
  id,
  graphId,
  nodeId,
  x: 0,
  y: 0,
  createdAt: 1,
  updatedAt: 1,
})

describe('SqliteStore put()', () => {
  it('raises a constraint error on a secondary unique-index conflict (not OR REPLACE)', async () => {
    await db.placements.put(placement('p1', 'g1', 'n1'))
    // Same (graphId,nodeId) under a new id violates the unique index. OR REPLACE
    // would silently delete p1; the upsert-on-pk must throw instead.
    await expect(db.placements.put(placement('p2', 'g1', 'n1'))).rejects.toThrow()
    expect(await db.placements.get('p1')).toBeTruthy()
    expect(await db.placements.get('p2')).toBeUndefined()
  })

  it('upserts in place when the primary key matches', async () => {
    await db.placements.put(placement('p1', 'g1', 'n1'))
    await db.placements.put({ ...placement('p1', 'g1', 'n1'), x: 99 })
    expect((await db.placements.get('p1'))?.x).toBe(99)
  })
})
