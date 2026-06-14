import { beforeEach, describe, expect, it } from 'vitest'
import { freshDb } from '../../test/helpers'
import { assertIntegrity } from '../../test/integrity'
import { getMeta, type GnosisDB } from '../db'
import { canRedo, canUndo, dispatch, redo, undo } from './dispatcher'
import { createEdge } from './edgeCommands'
import { renameNodeFile, setFileContent } from './fileCommands'
import { createNode } from './nodeCommands'

let db: GnosisDB
let graphId: string

beforeEach(async () => {
  db = await freshDb()
  graphId = (await getMeta<string>(db, 'rootGraphId'))!
})

describe('undo/redo stack semantics (§8)', () => {
  it('caps the stack at 100, evicting the oldest', async () => {
    for (let i = 0; i < 105; i++) {
      await dispatch(createNode({ title: `node ${i}` }))
    }
    let undos = 0
    while (canUndo()) {
      await undo()
      undos++
    }
    expect(undos).toBe(100)
    // 5 evicted creations survive, plus the seeded Home pointer node
    expect(await db.nodes.count()).toBe(6)
  })

  it('a new dispatch clears redo', async () => {
    const a = createNode({ title: 'a' })
    await dispatch(a)
    await undo()
    await dispatch(createNode({ title: 'c' }))
    expect(canRedo()).toBe(false)
    expect(await db.nodes.get(a.nodeId)).toBeUndefined()
  })

  it('transient file-content edits skip the stacks and preserve redo', async () => {
    const b = createNode({
      title: 'b',
      file: { filename: 'untitled.md', format: 'markdown', content: '' },
    })
    await dispatch(b)
    const a = createNode({ title: 'a' })
    await dispatch(a)
    await undo()
    expect(canRedo()).toBe(true)

    await dispatch(setFileContent(b.fileId!, 'typed while redo pending'))
    expect(canRedo()).toBe(true)

    await redo()
    expect(await db.nodes.get(a.nodeId)).toBeDefined()
    expect((await db.files.get(b.fileId!))!.content).toBe('typed while redo pending')

    await undo() // pops redo of a, not the transient edit
    expect(await db.nodes.get(a.nodeId)).toBeUndefined()
    expect((await db.files.get(b.fileId!))!.content).toBe('typed while redo pending')
  })

  it('rename-node-file patch-undo preserves transient content edits and round-trips the language key', async () => {
    const a = createNode({
      title: 'a',
      file: { filename: 'untitled.md', format: 'markdown', content: '' },
    })
    await dispatch(a)
    await dispatch(renameNodeFile(a.nodeId, 'app.py', 'code', 'python'))
    await dispatch(setFileContent(a.fileId!, 'typed after the rename'))

    await undo() // pops the rename — the transient content edit is not on the stack
    let file = (await db.files.get(a.fileId!))!
    expect(file.content).toBe('typed after the rename')
    expect(file.format).toBe('markdown')
    expect(file.language).toBeUndefined()
    expect(file.filename).toBe('untitled.md')

    await redo()
    file = (await db.files.get(a.fileId!))!
    expect(file.content).toBe('typed after the rename')
    expect(file).toMatchObject({ filename: 'app.py', format: 'code', language: 'python' })
    await assertIntegrity(db)
  })

  it('redo reuses factory-generated ids, so dependent records stay valid', async () => {
    const a = createNode({ title: 'a', placement: { graphId, x: 0, y: 0 } })
    const b = createNode({ title: 'b', placement: { graphId, x: 100, y: 0 } })
    await dispatch(a)
    await dispatch(b)
    const relationTypeId = (await db.relationTypes.toArray())[0]!.id
    await dispatch(
      createEdge({ graphId, fromNodeId: a.nodeId, toNodeId: b.nodeId, relationTypeId }),
    )

    await undo() // edge
    await undo() // b
    await undo() // a
    // only the seeded Home pointer node remains
    expect(await db.nodes.count()).toBe(1)

    await redo()
    await redo()
    await redo()
    expect(await db.nodes.get(a.nodeId)).toBeDefined()
    expect(await db.edges.where('fromNodeId').equals(a.nodeId).count()).toBe(1)
    await assertIntegrity(db)
  })
})
