import { beforeEach, describe, expect, it } from 'vitest'
import { freshDb } from '../../test/helpers'
import { assertIntegrity } from '../../test/integrity'
import { getMeta, type GnosisDB } from '../db'
import type { FileRecord } from '../types'
import { dispatch, redo, undo } from './dispatcher'
import { renameNodeFile, setFileContent, setNodeFile, setNodeLink } from './fileCommands'
import { createNode } from './nodeCommands'

let db: GnosisDB

beforeEach(async () => {
  db = await freshDb()
})

async function makeNode(): Promise<string> {
  const graphId = (await getMeta<string>(db, 'rootGraphId'))!
  // These suites exercise file-payload commands, so seed an explicit file
  // (createNode no longer auto-mints one).
  const command = createNode({
    title: 'n',
    file: { filename: 'untitled.md', format: 'markdown', content: '' },
    placement: { graphId, x: 0, y: 0 },
  })
  await dispatch(command)
  return command.nodeId
}

async function seedFile(): Promise<FileRecord> {
  const now = Date.now()
  const file: FileRecord = {
    id: crypto.randomUUID(),
    nodeId: crypto.randomUUID(),
    filename: 'notes.md',
    format: 'markdown',
    content: 'before',
    createdAt: now,
    updatedAt: now,
  }
  await db.files.add(file)
  return file
}

describe('setFileContent', () => {
  it('updates the file content and emits files-changed', async () => {
    const file = await seedFile()
    const command = setFileContent(file.id, 'after')
    await dispatch(command)
    const updated = await db.files.get(file.id)
    expect(updated?.content).toBe('after')
  })

  it('throws when the file is missing', async () => {
    await expect(dispatch(setFileContent('missing', 'x'))).rejects.toThrow(/not found/)
  })
})

describe('setNodeFile', () => {
  it('mints a fresh file, deletes the old one, and round-trips on undo/redo', async () => {
    const nodeId = await makeNode()
    const oldFileId = (await db.nodes.get(nodeId))!.payload as { fileId: string }
    await dispatch(setFileContent(oldFileId.fileId, 'old content'))

    const command = setNodeFile(nodeId, 'app.py', 'code', 'python')
    await dispatch(command)
    await assertIntegrity(db)
    const node = await db.nodes.get(nodeId)
    expect(node!.payload).toEqual({ kind: 'file', fileId: command.fileId })
    expect(await db.files.get(oldFileId.fileId)).toBeUndefined()
    const file = await db.files.get(command.fileId)
    expect(file).toMatchObject({ filename: 'app.py', format: 'code', language: 'python', content: '' })

    await undo()
    await assertIntegrity(db)
    expect((await db.nodes.get(nodeId))!.payload).toEqual({ kind: 'file', fileId: oldFileId.fileId })
    expect((await db.files.get(oldFileId.fileId))!.content).toBe('old content')
    expect(await db.files.get(command.fileId)).toBeUndefined()

    await redo()
    await assertIntegrity(db)
    expect((await db.nodes.get(nodeId))!.payload).toEqual({ kind: 'file', fileId: command.fileId })
  })

  it('restores a prior link payload on undo (link → file)', async () => {
    const nodeId = await makeNode()
    await dispatch(setNodeLink(nodeId, 'https://keep.test'))
    const command = setNodeFile(nodeId, 'app.py', 'code', 'python')
    await dispatch(command)
    await assertIntegrity(db)
    expect((await db.nodes.get(nodeId))!.payload).toEqual({ kind: 'file', fileId: command.fileId })

    await undo()
    await assertIntegrity(db)
    // The previous link URL must come back — not be wiped to no payload.
    expect((await db.nodes.get(nodeId))!.payload).toEqual({ kind: 'link', url: 'https://keep.test' })
    expect(await db.files.get(command.fileId)).toBeUndefined()
  })
})

describe('renameNodeFile', () => {
  it('renames and re-formats the file; undo restores filename/format/language', async () => {
    const nodeId = await makeNode()
    await dispatch(renameNodeFile(nodeId, 'data.json', 'code', 'json'))
    let file = (await db.files.where('nodeId').equals(nodeId).first())!
    expect(file).toMatchObject({ filename: 'data.json', format: 'code', language: 'json' })

    await undo()
    file = (await db.files.where('nodeId').equals(nodeId).first())!
    expect(file).toMatchObject({ filename: 'untitled.md', format: 'markdown' })
    expect(file.language).toBeUndefined()
  })

  it('throws on a node with no file payload', async () => {
    const nodeId = await makeNode()
    await dispatch(setNodeLink(nodeId, 'https://x.test'))
    await expect(dispatch(renameNodeFile(nodeId, 'x.md', 'markdown'))).rejects.toThrow(
      /no file payload/,
    )
  })
})

describe('setNodeLink', () => {
  it('replaces a file payload with a link and round-trips on undo/redo', async () => {
    const nodeId = await makeNode()
    const fileId = (await db.nodes.get(nodeId))!.payload as { fileId: string }

    const command = setNodeLink(nodeId, 'https://example.com')
    await dispatch(command)
    await assertIntegrity(db)
    expect((await db.nodes.get(nodeId))!.payload).toEqual({
      kind: 'link',
      url: 'https://example.com',
    })
    expect(await db.files.get(fileId.fileId)).toBeUndefined()

    await undo()
    await assertIntegrity(db)
    expect((await db.nodes.get(nodeId))!.payload).toEqual({ kind: 'file', fileId: fileId.fileId })
    expect(await db.files.get(fileId.fileId)).toBeDefined()

    await redo()
    await assertIntegrity(db)
    expect((await db.nodes.get(nodeId))!.payload).toEqual({
      kind: 'link',
      url: 'https://example.com',
    })
  })

  it('restores a prior link URL on undo (link → link)', async () => {
    const nodeId = await makeNode()
    await dispatch(setNodeLink(nodeId, 'https://first.test'))
    await dispatch(setNodeLink(nodeId, 'https://second.test'))
    await assertIntegrity(db)
    expect((await db.nodes.get(nodeId))!.payload).toEqual({ kind: 'link', url: 'https://second.test' })

    await undo()
    await assertIntegrity(db)
    // The previous URL must come back — not be wiped to no payload (the F3 bug).
    expect((await db.nodes.get(nodeId))!.payload).toEqual({ kind: 'link', url: 'https://first.test' })
  })
})
