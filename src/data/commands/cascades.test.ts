import { beforeEach, describe, expect, it } from 'vitest'
import { dumpAll, freshDb, type WorkspaceDump } from '../../test/helpers'
import { assertIntegrity } from '../../test/integrity'
import { getMeta, type GnosisDB, setMeta } from '../db'
import { canUndo, clearHistory, dispatch, redo, undo } from './dispatcher'
import { createEdge, deleteEdges } from './edgeCommands'
import { createGraph, deleteGraph, deleteGraphDeep } from './graphCommands'
import { HomeDeletionError } from './integrity'
import {
  createNode,
  createSubGraph,
  deleteNodeEverywhere,
  deleteNodesEverywhere,
} from './nodeCommands'
import { addPlacement, movePlacements, removeFromCanvas } from './placementCommands'
import type { Command } from './types'

interface Fixture {
  db: GnosisDB
  graphA: string
  graphB: string
  n1: string
  n2: string
  n3: string
  n2File: string
  n3File: string
  p1A: string
  p1B: string
  relatesTo: string
  edgeA: string
  edgeB: string
}

/**
 * graphA: n1, n2 placed; edge n1 -> n2.
 * graphB: n1 (reused), n3 placed; edge n1 -> n3.
 */
async function buildFixture(): Promise<Fixture> {
  const db = await freshDb()
  const graphA = (await getMeta<string>(db, 'rootGraphId'))!
  const makeGraphB = createGraph('Graph B')
  await dispatch(makeGraphB)
  const graphB = makeGraphB.graphId

  const make1 = createNode({ title: 'n1', placement: { graphId: graphA, x: 0, y: 0 } })
  const make2 = createNode({
    title: 'n2',
    file: { filename: 'n2.md', format: 'markdown', content: 'n2 body' },
    placement: { graphId: graphA, x: 200, y: 0 },
  })
  const make3 = createNode({
    title: 'n3',
    file: { filename: 'n3.md', format: 'markdown', content: 'n3 body' },
    placement: { graphId: graphB, x: 0, y: 200 },
  })
  await dispatch(make1)
  await dispatch(make2)
  await dispatch(make3)
  const place1B = addPlacement(graphB, make1.nodeId, 100, 100)
  await dispatch(place1B)

  const relatesTo = (await db.relationTypes.filter((t) => t.name === 'relates to').first())!.id
  const makeEdgeA = createEdge({
    graphId: graphA,
    fromNodeId: make1.nodeId,
    toNodeId: make2.nodeId,
    relationTypeId: relatesTo,
  })
  const makeEdgeB = createEdge({
    graphId: graphB,
    fromNodeId: make1.nodeId,
    toNodeId: make3.nodeId,
    relationTypeId: relatesTo,
  })
  await dispatch(makeEdgeA)
  await dispatch(makeEdgeB)

  return {
    db,
    graphA,
    graphB,
    n1: make1.nodeId,
    n2: make2.nodeId,
    n3: make3.nodeId,
    n2File: make2.fileId!,
    n3File: make3.fileId!,
    p1A: make1.placementId!,
    p1B: place1B.placementId,
    relatesTo,
    edgeA: makeEdgeA.edgeId,
    edgeB: makeEdgeB.edgeId,
  }
}

let f: Fixture
let before: WorkspaceDump

beforeEach(async () => {
  f = await buildFixture()
  before = await dumpAll(f.db)
})

async function expectUndoRestoresAndRedoRepeats(command: Command): Promise<void> {
  await dispatch(command)
  await assertIntegrity(f.db)
  const after = await dumpAll(f.db)
  await undo()
  await assertIntegrity(f.db)
  expect(await dumpAll(f.db)).toEqual(before)
  await redo()
  await assertIntegrity(f.db)
  expect(await dumpAll(f.db)).toEqual(after)
}

describe('deletion cascade matrix (§3)', () => {
  it('remove placement: kills that placement + same-graph edges; node and other placements survive', async () => {
    await dispatch(removeFromCanvas([f.p1A]))
    await assertIntegrity(f.db)
    expect(await f.db.placements.get(f.p1A)).toBeUndefined()
    expect(await f.db.edges.get(f.edgeA)).toBeUndefined()
    expect(await f.db.nodes.get(f.n1)).toBeDefined()
    expect(await f.db.placements.get(f.p1B)).toBeDefined()
    expect(await f.db.edges.get(f.edgeB)).toBeDefined()
    await undo()
    expect(await dumpAll(f.db)).toEqual(before)
    await assertIntegrity(f.db)
  })

  it('remove placement: undo/redo round-trips exactly', async () => {
    await expectUndoRestoresAndRedoRepeats(removeFromCanvas([f.p1A]))
  })

  it('delete edge: that edge only; endpoints and placements survive', async () => {
    await dispatch(deleteEdges([f.edgeA]))
    await assertIntegrity(f.db)
    expect(await f.db.edges.get(f.edgeA)).toBeUndefined()
    expect(await f.db.edges.get(f.edgeB)).toBeDefined()
    expect(await f.db.nodes.get(f.n1)).toBeDefined()
    expect(await f.db.placements.get(f.p1A)).toBeDefined()
    await undo()
    expect(await dumpAll(f.db)).toEqual(before)
  })

  it('delete node everywhere: node, all placements, all edges gone; child graph survives', async () => {
    const sub = createSubGraph(f.n1, 'n1 internals')
    await dispatch(sub)
    const withSub = await dumpAll(f.db)

    await dispatch(deleteNodeEverywhere(f.n1))
    await assertIntegrity(f.db)
    expect(await f.db.nodes.get(f.n1)).toBeUndefined()
    expect(await f.db.placements.where('nodeId').equals(f.n1).count()).toBe(0)
    expect(await f.db.edges.get(f.edgeA)).toBeUndefined()
    expect(await f.db.edges.get(f.edgeB)).toBeUndefined()
    expect(await f.db.graphs.get(sub.graphId)).toBeDefined()
    expect(await f.db.nodes.get(f.n2)).toBeDefined()

    await undo()
    await assertIntegrity(f.db)
    expect(await dumpAll(f.db)).toEqual(withSub)
  })

  it('delete graph: graph, its placements and edges gone; nodes survive', async () => {
    await dispatch(deleteGraph(f.graphB))
    await assertIntegrity(f.db)
    expect(await f.db.graphs.get(f.graphB)).toBeUndefined()
    expect(await f.db.placements.where('graphId').equals(f.graphB).count()).toBe(0)
    expect(await f.db.edges.where('graphId').equals(f.graphB).count()).toBe(0)
    expect(await f.db.nodes.get(f.n1)).toBeDefined()
    expect(await f.db.nodes.get(f.n3)).toBeDefined()
    await undo()
    await assertIntegrity(f.db)
    expect(await dumpAll(f.db)).toEqual(before)
  })

  it('move-placements (Tidy): bulk-moves and restores exact positions on undo', async () => {
    const before = (await f.db.placements.get(f.p1A))!
    await dispatch(movePlacements([{ placementId: f.p1A, x: 999, y: 888 }]))
    const moved = (await f.db.placements.get(f.p1A))!
    expect([moved.x, moved.y]).toEqual([999, 888])
    await undo()
    const restored = (await f.db.placements.get(f.p1A))!
    expect([restored.x, restored.y]).toEqual([before.x, before.y])
  })

  it('delete graph: clears childGraphId on referring nodes and restores it on undo', async () => {
    const pointer = createNode({ title: 'opens B' })
    await dispatch(pointer)
    await f.db.nodes.put({ ...(await f.db.nodes.get(pointer.nodeId))!, childGraphId: f.graphB })
    const withPointer = await dumpAll(f.db)

    await dispatch(deleteGraph(f.graphB))
    await assertIntegrity(f.db)
    expect((await f.db.nodes.get(pointer.nodeId))!.childGraphId).toBeUndefined()

    await undo()
    await assertIntegrity(f.db)
    expect(await dumpAll(f.db)).toEqual(withPointer)
  })

  it('refuses to delete Home', async () => {
    await setMeta(f.db, 'homeGraphId', f.graphA)
    await expect(dispatch(deleteGraph(f.graphA))).rejects.toBeInstanceOf(HomeDeletionError)
    expect(await f.db.graphs.get(f.graphA)).toBeDefined()
  })

  it('create sub-graph: one undo removes the graph and restores the node pointer', async () => {
    await expectUndoRestoresAndRedoRepeats(createSubGraph(f.n2, 'n2 internals'))
  })
})

describe('bulk delete-everywhere (composite, one undo step)', () => {
  it('deletes several nodes with their placements/edges/files; one undo restores all', async () => {
    await dispatch(deleteNodesEverywhere([f.n2, f.n3]))
    await assertIntegrity(f.db)
    // both nodes, their files, their placements, and edges touching them are gone
    expect(await f.db.nodes.get(f.n2)).toBeUndefined()
    expect(await f.db.nodes.get(f.n3)).toBeUndefined()
    expect(await f.db.files.get(f.n2File)).toBeUndefined()
    expect(await f.db.files.get(f.n3File)).toBeUndefined()
    expect(await f.db.edges.get(f.edgeA)).toBeUndefined() // n1 -> n2
    expect(await f.db.edges.get(f.edgeB)).toBeUndefined() // n1 -> n3
    expect(await f.db.nodes.get(f.n1)).toBeDefined() // untouched node survives

    // one undo step restores the whole workspace exactly
    await undo()
    await assertIntegrity(f.db)
    expect(await dumpAll(f.db)).toEqual(before)
  })

  it('is a single dispatch + undo step and redo repeats it', async () => {
    // a fresh workspace edit history: only this composite is on the stack
    clearHistory()
    await dispatch(deleteNodesEverywhere([f.n2, f.n3]))
    await undo() // one undo reverts the whole composite
    expect(canUndo()).toBe(false)
    expect(await dumpAll(f.db)).toEqual(before)
    // redo repeats it cleanly
    await redo()
    expect(await f.db.nodes.get(f.n2)).toBeUndefined()
    expect(await f.db.nodes.get(f.n3)).toBeUndefined()
  })
})

describe('deep graph delete (composite, one undo step)', () => {
  it('deletes the graph + nodes placed only in it; shared nodes survive; one undo restores', async () => {
    // n3 is placed only in graphB; n1 is placed in both A and B (shared).
    await dispatch(deleteGraphDeep(f.graphB))
    await assertIntegrity(f.db)
    expect(await f.db.graphs.get(f.graphB)).toBeUndefined()
    // n3 was exclusive to graphB ⇒ node + its file are gone
    expect(await f.db.nodes.get(f.n3)).toBeUndefined()
    expect(await f.db.files.get(f.n3File)).toBeUndefined()
    // n1 is also placed in graphA ⇒ survives, only its graphB placement dropped
    expect(await f.db.nodes.get(f.n1)).toBeDefined()
    expect(await f.db.placements.where('nodeId').equals(f.n1).count()).toBe(1)
    expect((await f.db.placements.where('nodeId').equals(f.n1).first())!.graphId).toBe(f.graphA)
    // n2 (graphA only) is untouched
    expect(await f.db.nodes.get(f.n2)).toBeDefined()

    await undo()
    await assertIntegrity(f.db)
    expect(await dumpAll(f.db)).toEqual(before)
  })

  it('is a single dispatch + undo step and redo repeats it', async () => {
    clearHistory()
    await dispatch(deleteGraphDeep(f.graphB))
    await undo() // one undo reverts the whole composite
    expect(canUndo()).toBe(false)
    expect(await dumpAll(f.db)).toEqual(before)
    await redo()
    expect(await f.db.graphs.get(f.graphB)).toBeUndefined()
    expect(await f.db.nodes.get(f.n3)).toBeUndefined()
  })

  it('refuses to deep-delete Home (deleteGraph throws HomeDeletionError)', async () => {
    await setMeta(f.db, 'homeGraphId', f.graphB)
    await expect(dispatch(deleteGraphDeep(f.graphB))).rejects.toBeInstanceOf(HomeDeletionError)
    // the graph and its exclusively-placed node survive the refused delete
    expect(await f.db.graphs.get(f.graphB)).toBeDefined()
    expect(await f.db.nodes.get(f.n3)).toBeDefined()
  })
})
