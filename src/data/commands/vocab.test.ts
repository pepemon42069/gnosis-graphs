import { beforeEach, describe, expect, it } from 'vitest'
import { dumpAll, freshDb, type WorkspaceDump } from '../../test/helpers'
import { assertIntegrity } from '../../test/integrity'
import { getMeta, type GnosisDB } from '../db'
import { dispatch, redo, undo } from './dispatcher'
import { createEdge } from './edgeCommands'
import { DuplicateNameError, VocabInUseError } from './integrity'
import { deleteKind, ensureKind, mergeKind, renameKind } from './kindCommands'
import { setFileContent } from './fileCommands'
import { createNode } from './nodeCommands'
import { deleteRelationType, mergeRelationType, renameRelationType } from './relationTypeCommands'
import type { Command } from './types'

interface Fixture {
  db: GnosisDB
  cites: string
  relatesTo: string
  paper: string
  concept: string
  edgeId: string
  nodeId: string
  fileId: string
}

/** Root graph with two nodes; n1 -(cites)-> n2; n1 has kind `paper`. */
async function buildFixture(): Promise<Fixture> {
  const db = await freshDb()
  const graphId = (await getMeta<string>(db, 'rootGraphId'))!
  const cites = (await db.relationTypes.filter((t) => t.name === 'cites').first())!.id
  const relatesTo = (await db.relationTypes.filter((t) => t.name === 'relates to').first())!.id
  const paper = (await db.kinds.filter((k) => k.name === 'paper').first())!.id
  const concept = (await db.kinds.filter((k) => k.name === 'concept').first())!.id

  const make1 = createNode({
    title: 'n1',
    kindId: paper,
    file: { filename: 'untitled.md', format: 'markdown', content: '' },
    placement: { graphId, x: 0, y: 0 },
  })
  const make2 = createNode({ title: 'n2', placement: { graphId, x: 200, y: 0 } })
  await dispatch(make1)
  await dispatch(make2)
  const makeEdge = createEdge({
    graphId,
    fromNodeId: make1.nodeId,
    toNodeId: make2.nodeId,
    relationTypeId: cites,
  })
  await dispatch(makeEdge)

  return {
    db,
    cites,
    relatesTo,
    paper,
    concept,
    edgeId: makeEdge.edgeId,
    nodeId: make1.nodeId,
    fileId: make1.fileId!,
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

describe('vocabulary commands (§3, §5)', () => {
  it('merge relation type: re-points edges, deletes the source; undo/redo round-trips', async () => {
    await expectUndoRestoresAndRedoRepeats(mergeRelationType(f.cites, f.relatesTo))
    expect((await f.db.edges.get(f.edgeId))!.relationTypeId).toBe(f.relatesTo)
    expect(await f.db.relationTypes.get(f.cites)).toBeUndefined()
  })

  it('merge kind: re-points nodes, deletes the source; undo/redo round-trips', async () => {
    await expectUndoRestoresAndRedoRepeats(mergeKind(f.paper, f.concept))
    expect((await f.db.nodes.get(f.nodeId))!.kindId).toBe(f.concept)
    expect(await f.db.kinds.get(f.paper)).toBeUndefined()
  })

  it('merging an entry into itself is refused', () => {
    expect(() => mergeRelationType(f.cites, f.cites)).toThrow()
    expect(() => mergeKind(f.paper, f.paper)).toThrow()
  })

  it('merging into a missing target is refused, nothing re-pointed (§3)', async () => {
    await expect(dispatch(mergeRelationType(f.cites, 'missing'))).rejects.toThrow()
    await expect(dispatch(mergeKind(f.paper, 'missing'))).rejects.toThrow()
    expect(await dumpAll(f.db)).toEqual(before)
    await assertIntegrity(f.db)
  })

  it('merge-kind undo preserves transient edits made after the merge (§6/§8)', async () => {
    await dispatch(mergeKind(f.paper, f.concept))
    await dispatch(setFileContent(f.fileId, 'typed after the merge'))
    await undo() // pops the merge — the transient edit is not on the stack
    const node = (await f.db.nodes.get(f.nodeId))!
    expect(node.kindId).toBe(f.paper)
    expect((await f.db.files.get(f.fileId))!.content).toBe('typed after the merge')
    await assertIntegrity(f.db)
  })

  it('delete relation type: refused while in use, with the usage count', async () => {
    await expect(dispatch(deleteRelationType(f.cites))).rejects.toBeInstanceOf(VocabInUseError)
    await expect(dispatch(deleteRelationType(f.cites))).rejects.toMatchObject({ count: 1 })
    expect(await dumpAll(f.db)).toEqual(before)
  })

  it('delete relation type: succeeds when unused; undo restores', async () => {
    const unused = (await f.db.relationTypes.filter((t) => t.name === 'contradicts').first())!.id
    await expectUndoRestoresAndRedoRepeats(deleteRelationType(unused))
    expect(await f.db.relationTypes.get(unused)).toBeUndefined()
  })

  it('delete kind: refused while in use, succeeds when unused; undo restores', async () => {
    await expect(dispatch(deleteKind(f.paper))).rejects.toBeInstanceOf(VocabInUseError)
    const unused = (await f.db.kinds.filter((k) => k.name === 'decision').first())!.id
    await expectUndoRestoresAndRedoRepeats(deleteKind(unused))
    expect(await f.db.kinds.get(unused)).toBeUndefined()
  })

  it('rename to an existing name (case-insensitive) is refused', async () => {
    await expect(dispatch(renameRelationType(f.cites, ' IMPLEMENTS '))).rejects.toBeInstanceOf(
      DuplicateNameError,
    )
    await expect(dispatch(renameKind(f.paper, 'Concept'))).rejects.toBeInstanceOf(
      DuplicateNameError,
    )
    expect(await dumpAll(f.db)).toEqual(before)
  })

  it('rename to its own name with different casing is allowed', async () => {
    await dispatch(renameRelationType(f.cites, 'Cites'))
    expect((await f.db.relationTypes.get(f.cites))!.name).toBe('Cites')
    await dispatch(renameKind(f.paper, 'PAPER'))
    expect((await f.db.kinds.get(f.paper))!.name).toBe('PAPER')
    await undo()
    await undo()
    expect(await dumpAll(f.db)).toEqual(before)
  })

  it("ensureKind('Concept') selects the seeded kind instead of creating", async () => {
    expect(await ensureKind('Concept')).toBe(f.concept)
    expect(await f.db.kinds.count()).toBe(5)
  })
})
