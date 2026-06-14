import type { GnosisDB } from '../db'
import type { StoreEvent } from '../events'
import type { FileRecord, NodeRecord, PayloadFormat } from '../types'
import { getNodeOrThrow, transientUndo } from './nodeCommands'
import type { Command } from './types'

async function getFileOrThrow(db: GnosisDB, fileId: string): Promise<FileRecord> {
  const file = await db.files.get(fileId)
  if (!file) throw new Error(`File ${fileId} not found`)
  return file
}

/** The node's file payload, if it has one. */
async function fileOfNode(db: GnosisDB, nodeId: string): Promise<FileRecord | undefined> {
  const node = await db.nodes.get(nodeId)
  if (node?.payload?.kind !== 'file') return undefined
  return db.files.get(node.payload.fileId)
}

// Replacing a node's payload (set-node-file / set-node-link) must capture the
// WHOLE prior payload — file OR link — so undo restores it exactly. Capturing
// only a prior file (the old bug) silently dropped a prior link URL on undo.
type PriorPayload =
  | { kind: 'file'; file: FileRecord; updatedAt: number }
  | { kind: 'link'; url: string; updatedAt: number }
  | null

/** Snapshot the node's current payload and delete its now-orphaned file (if any). */
async function capturePriorPayload(db: GnosisDB, node: NodeRecord): Promise<PriorPayload> {
  if (node.payload?.kind === 'file') {
    const file = await db.files.get(node.payload.fileId)
    if (!file) return null
    await db.files.delete(file.id)
    return { kind: 'file', file: structuredClone(file), updatedAt: node.updatedAt }
  }
  if (node.payload?.kind === 'link') {
    return { kind: 'link', url: node.payload.url, updatedAt: node.updatedAt }
  }
  return null
}

/** Restore a payload captured by capturePriorPayload, re-adding a prior file. */
async function restorePriorPayload(db: GnosisDB, nodeId: string, prior: PriorPayload): Promise<void> {
  const node = await db.nodes.get(nodeId)
  if (!node) return
  const restored: NodeRecord = { ...node, updatedAt: prior?.updatedAt ?? node.updatedAt }
  if (prior?.kind === 'file') restored.payload = { kind: 'file', fileId: prior.file.id }
  else if (prior?.kind === 'link') restored.payload = { kind: 'link', url: prior.url }
  else delete restored.payload
  await db.nodes.put(restored)
  if (prior?.kind === 'file') await db.files.add(prior.file)
}

/** File ids touched by a prior payload, for files-changed events. */
const priorFileIds = (prior: PriorPayload): string[] => (prior?.kind === 'file' ? [prior.file.id] : [])

export function setFileContent(fileId: string, content: string): Command {
  const now = Date.now()
  return {
    label: 'set-file-content',
    transient: true,
    async do(db) {
      const file = await getFileOrThrow(db, fileId)
      await db.files.put({ ...file, content, updatedAt: now })
      return [{ type: 'files-changed', fileIds: [fileId] }]
    },
    undo: transientUndo,
  }
}

export interface SetNodeFileCommand extends Command {
  fileId: string
}

/** Mints a fresh empty file for the node; replaces any prior file payload. */
export function setNodeFile(
  nodeId: string,
  filename: string,
  format: PayloadFormat,
  language?: string,
): SetNodeFileCommand {
  const fileId = crypto.randomUUID()
  const now = Date.now()
  let prior: PriorPayload = null
  return {
    label: 'set-node-file',
    fileId,
    async do(db) {
      const node = await getNodeOrThrow(db, nodeId)
      prior = await capturePriorPayload(db, node)
      await db.files.add({
        id: fileId,
        nodeId,
        filename,
        format,
        ...(language ? { language } : {}),
        content: '',
        createdAt: now,
        updatedAt: now,
      })
      await db.nodes.put({ ...node, payload: { kind: 'file', fileId }, updatedAt: now })
      return fileEvents(nodeId, [fileId], priorFileIds(prior))
    },
    async undo(db) {
      await db.files.delete(fileId)
      await restorePriorPayload(db, nodeId, prior)
      return fileEvents(nodeId, priorFileIds(prior), [fileId])
    },
  }
}

/** Renames the node's file and re-detects its format (the panel filename field). */
export function renameNodeFile(
  nodeId: string,
  filename: string,
  format: PayloadFormat,
  language?: string,
): Command {
  const now = Date.now()
  // Patch only filename/format/language: a transient content edit made after the
  // rename must survive a structural undo (§6/§8).
  let captured: { id: string; filename: string; format: PayloadFormat; language?: string; updatedAt: number } | null =
    null
  return {
    label: 'rename-node-file',
    async do(db) {
      const file = await fileOfNode(db, nodeId)
      if (!file) throw new Error(`Node ${nodeId} has no file payload`)
      captured = {
        id: file.id,
        filename: file.filename,
        format: file.format,
        ...(file.language ? { language: file.language } : {}),
        updatedAt: file.updatedAt,
      }
      const next: FileRecord = { ...file, filename, format, updatedAt: now }
      if (language) next.language = language
      else delete next.language
      await db.files.put(next)
      return [
        { type: 'files-changed', fileIds: [file.id] },
        { type: 'nodes-changed', upserted: [nodeId], removed: [] },
      ]
    },
    async undo(db) {
      const file = captured ? await db.files.get(captured.id) : undefined
      if (file && captured) {
        const restored: FileRecord = {
          ...file,
          filename: captured.filename,
          format: captured.format,
          updatedAt: captured.updatedAt,
        }
        if (captured.language) restored.language = captured.language
        else delete restored.language
        await db.files.put(restored)
      }
      return [
        { type: 'files-changed', fileIds: captured ? [captured.id] : [] },
        { type: 'nodes-changed', upserted: [nodeId], removed: [] },
      ]
    },
  }
}

/** Points the node at a link URL; drops any prior file payload. */
export function setNodeLink(nodeId: string, url: string): Command {
  const now = Date.now()
  let prior: PriorPayload = null
  return {
    label: 'set-node-link',
    async do(db) {
      const node = await getNodeOrThrow(db, nodeId)
      prior = await capturePriorPayload(db, node)
      await db.nodes.put({ ...node, payload: { kind: 'link', url }, updatedAt: now })
      return fileEvents(nodeId, [], priorFileIds(prior))
    },
    async undo(db) {
      await restorePriorPayload(db, nodeId, prior)
      return fileEvents(nodeId, priorFileIds(prior), [])
    },
  }
}

function fileEvents(nodeId: string, added: string[], removed: string[]): StoreEvent[] {
  const events: StoreEvent[] = [{ type: 'nodes-changed', upserted: [nodeId], removed: [] }]
  // A removed file still fires files-changed so the FS mirror reconciles, but it
  // is left out of fileIds: the client must not re-fetch a deleted file (404),
  // and the owner node is already reindexed by nodes-changed.
  if (added.length || removed.length) {
    events.push({ type: 'files-changed', fileIds: added })
  }
  return events
}
