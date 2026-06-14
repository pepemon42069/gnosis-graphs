import { beforeEach, describe, expect, it } from 'vitest'
import { freshDb } from '../../test/helpers'
import { getMeta, type GnosisDB } from '../db'
import { dispatch } from './dispatcher'
import { EmptyTitleError, PlacementExistsError } from './integrity'
import { createNode } from './nodeCommands'
import { setNodeTitle } from './payloadCommands'
import { addPlacement } from './placementCommands'
import { createRelationType, ensureRelationType } from './relationTypeCommands'

let db: GnosisDB
let graphId: string

beforeEach(async () => {
  db = await freshDb()
  graphId = (await getMeta<string>(db, 'rootGraphId'))!
})

describe('invariants (§3)', () => {
  it('at most one placement per (graphId, nodeId): dispatcher throws with the existing id', async () => {
    const make = createNode({ title: 'n', placement: { graphId, x: 0, y: 0 } })
    await dispatch(make)
    const duplicate = addPlacement(graphId, make.nodeId, 50, 50)
    await expect(dispatch(duplicate)).rejects.toBeInstanceOf(PlacementExistsError)
    await expect(dispatch(duplicate)).rejects.toMatchObject({
      existingPlacementId: make.placementId,
    })
    expect(await db.placements.where('nodeId').equals(make.nodeId).count()).toBe(1)
  })

  it('the unique compound index backstops the placement invariant at the DB layer', async () => {
    const make = createNode({ title: 'n', placement: { graphId, x: 0, y: 0 } })
    await dispatch(make)
    await expect(
      db.placements.add({
        id: crypto.randomUUID(),
        graphId,
        nodeId: make.nodeId,
        x: 1,
        y: 1,
        createdAt: 0,
        updatedAt: 0,
      }),
    ).rejects.toThrow()
  })

  it('relation type names are unique case-insensitively: ensure selects instead of duplicating', async () => {
    const seeded = (await db.relationTypes.filter((t) => t.name === 'implements').first())!
    const ensured = await ensureRelationType('  IMPLEMENTS ')
    expect(ensured).toBe(seeded.id)
    expect(await db.relationTypes.count()).toBe(6)
  })

  it('creating a duplicate relation type name is refused', async () => {
    await expect(dispatch(createRelationType('Implements'))).rejects.toThrow(
      'An entry with this name already exists',
    )
  })

  it('ensure creates a missing relation type once', async () => {
    const id = await ensureRelationType('blocks')
    expect(await ensureRelationType('Blocks')).toBe(id)
    expect(await db.relationTypes.count()).toBe(7)
  })

  it('node titles must be non-empty: blank create and blank retitle throw', () => {
    expect(() => createNode({ title: '   ' })).toThrow(EmptyTitleError)
    expect(() => setNodeTitle('whatever', '')).toThrow(EmptyTitleError)
  })

  it('createNode with neither file nor link mints no payload and no FileRecord', async () => {
    const make = createNode({ title: 'bare', placement: { graphId, x: 0, y: 0 } })
    expect(make.fileId).toBeNull()
    await dispatch(make)
    const node = (await db.nodes.get(make.nodeId))!
    expect(node.payload).toBeUndefined()
    expect(await db.files.where('nodeId').equals(make.nodeId).count()).toBe(0)
  })

  it('createNode with an explicit file still mints the file payload', async () => {
    const make = createNode({
      title: 'doc',
      file: { filename: 'notes.md', format: 'markdown', content: 'hi' },
      placement: { graphId, x: 0, y: 0 },
    })
    expect(make.fileId).not.toBeNull()
    await dispatch(make)
    const node = (await db.nodes.get(make.nodeId))!
    expect(node.payload).toEqual({ kind: 'file', fileId: make.fileId })
    const file = (await db.files.get(make.fileId!))!
    expect(file).toMatchObject({ filename: 'notes.md', format: 'markdown', content: 'hi' })
  })
})
