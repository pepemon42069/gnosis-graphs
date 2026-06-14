import type { GnosisDB } from '../db'
import type { StoreEvent } from '../events'
import type { EdgeRecord, FileRecord, NodeRecord, Payload, PlacementRecord } from '../types'
import { composite } from './composite'
import { requireNonEmptyTitle } from './integrity'
import type { Command } from './types'

export async function getNodeOrThrow(db: GnosisDB, nodeId: string): Promise<NodeRecord> {
  const node = await db.nodes.get(nodeId)
  if (!node) throw new Error(`Node ${nodeId} not found`)
  return node
}

export function transientUndo(): never {
  throw new Error('Transient commands cannot be undone')
}

export interface CreateNodeOptions {
  title: string
  /** A starting file (its content seeds the minted FileRecord). */
  file?: { filename: string; format: FileRecord['format']; language?: string; content: string }
  /** A starting link payload (no file is minted). */
  link?: string
  kindId?: string
  tags?: string[]
  /** A short blurb shown on the graph card. */
  summary?: string
  placement?: { graphId: string; x: number; y: number }
}

export interface CreateNodeCommand extends Command {
  nodeId: string
  fileId: string | null
  placementId: string | null
}

export function createNode(opts: CreateNodeOptions): CreateNodeCommand {
  const title = requireNonEmptyTitle(opts.title)
  const nodeId = crypto.randomUUID()
  const placementId = opts.placement ? crypto.randomUUID() : null
  const now = Date.now()
  // A node has a file only when one is given; a link node carries no file; with
  // neither, the node is created with no payload (no auto `untitled.md`).
  const fileSpec = opts.link === undefined ? (opts.file ?? null) : null
  const fileId = fileSpec ? crypto.randomUUID() : null
  const payload: Payload | undefined = fileId
    ? { kind: 'file', fileId }
    : opts.link !== undefined
      ? { kind: 'link', url: opts.link }
      : undefined
  const placementEvents: StoreEvent[] = opts.placement
    ? [{ type: 'placements-changed', graphIds: [opts.placement.graphId] }]
    : []
  const fileEvents: StoreEvent[] = fileId ? [{ type: 'files-changed', fileIds: [fileId] }] : []
  return {
    label: 'create-node',
    nodeId,
    fileId,
    placementId,
    async do(db) {
      const node: NodeRecord = {
        id: nodeId,
        title,
        ...(opts.kindId ? { kindId: opts.kindId } : {}),
        ...(opts.summary ? { summary: opts.summary } : {}),
        tags: opts.tags ?? [],
        createdAt: now,
        updatedAt: now,
      }
      if (payload) node.payload = payload
      await db.nodes.add(node)
      if (fileSpec && fileId) {
        await db.files.add({
          id: fileId,
          nodeId,
          filename: fileSpec.filename,
          format: fileSpec.format,
          ...(fileSpec.language ? { language: fileSpec.language } : {}),
          content: fileSpec.content,
          createdAt: now,
          updatedAt: now,
        })
      }
      if (opts.placement && placementId) {
        await db.placements.add({
          id: placementId,
          graphId: opts.placement.graphId,
          nodeId,
          x: opts.placement.x,
          y: opts.placement.y,
          createdAt: now,
          updatedAt: now,
        })
      }
      return [
        { type: 'nodes-changed', upserted: [nodeId], removed: [] },
        ...fileEvents,
        ...placementEvents,
      ]
    },
    async undo(db) {
      if (placementId) await db.placements.delete(placementId)
      if (fileId) await db.files.delete(fileId)
      await db.nodes.delete(nodeId)
      return [
        { type: 'nodes-changed', upserted: [], removed: [nodeId] },
        ...fileEvents,
        ...placementEvents,
      ]
    },
  }
}

export interface NodeMetaPatch {
  title?: string
  /** Empty string clears the summary. */
  summary?: string
  kindId?: string | null
  tags?: string[]
}

/** One staged panel "Save" = one command = one undo step (§5). */
export function updateNodeMeta(nodeId: string, patch: NodeMetaPatch): Command {
  const title = patch.title === undefined ? undefined : requireNonEmptyTitle(patch.title)
  // Undo patches only the fields this command changes — the file payload and any
  // edits to it must survive a structural undo (§6/§8).
  let captured: Pick<NodeRecord, 'title' | 'summary' | 'kindId' | 'tags' | 'updatedAt'> | null = null
  const now = Date.now()
  return {
    label: 'update-node-meta',
    async do(db) {
      const node = await getNodeOrThrow(db, nodeId)
      captured = structuredClone({
        title: node.title,
        summary: node.summary,
        kindId: node.kindId,
        tags: node.tags,
        updatedAt: node.updatedAt,
      })
      const updated: NodeRecord = { ...node, updatedAt: now }
      if (title !== undefined) updated.title = title
      if (patch.summary !== undefined) {
        if (patch.summary) updated.summary = patch.summary
        else delete updated.summary
      }
      if (patch.kindId !== undefined) {
        if (patch.kindId === null) delete updated.kindId
        else updated.kindId = patch.kindId
      }
      if (patch.tags !== undefined) updated.tags = patch.tags
      await db.nodes.put(updated)
      return [{ type: 'nodes-changed', upserted: [nodeId], removed: [] }]
    },
    async undo(db) {
      const node = await db.nodes.get(nodeId)
      if (node && captured) {
        const restored: NodeRecord = {
          ...node,
          title: captured.title,
          tags: captured.tags,
          updatedAt: captured.updatedAt,
        }
        if (captured.summary === undefined) delete restored.summary
        else restored.summary = captured.summary
        if (captured.kindId === undefined) delete restored.kindId
        else restored.kindId = captured.kindId
        await db.nodes.put(restored)
      }
      return [{ type: 'nodes-changed', upserted: [nodeId], removed: [] }]
    },
  }
}

export interface CreateSubGraphCommand extends Command {
  graphId: string
}

export function createSubGraph(nodeId: string, name: string): CreateSubGraphCommand {
  const graphId = crypto.randomUUID()
  let priorUpdatedAt: number | null = null
  const now = Date.now()
  return {
    label: 'create-sub-graph',
    graphId,
    async do(db) {
      const node = await getNodeOrThrow(db, nodeId)
      if (node.childGraphId) throw new Error('Node already has a child graph')
      priorUpdatedAt = node.updatedAt
      await db.graphs.add({ id: graphId, name, createdAt: now, updatedAt: now })
      await db.nodes.put({ ...node, childGraphId: graphId, updatedAt: now })
      return [
        { type: 'graphs-changed', upserted: [graphId], removed: [] },
        { type: 'nodes-changed', upserted: [nodeId], removed: [] },
      ]
    },
    async undo(db) {
      await db.graphs.delete(graphId)
      // Patch only the pointer: edits made to the node since must survive.
      const node = await db.nodes.get(nodeId)
      if (node) {
        const restored = { ...node, updatedAt: priorUpdatedAt ?? node.updatedAt }
        delete restored.childGraphId
        await db.nodes.put(restored)
      }
      return [
        { type: 'graphs-changed', upserted: [], removed: [graphId] },
        { type: 'nodes-changed', upserted: [nodeId], removed: [] },
      ]
    },
  }
}

/** Points an existing node at an existing graph (§3 loose-end rescue). */
export function linkChildGraph(nodeId: string, graphId: string): Command {
  let priorUpdatedAt: number | null = null
  const now = Date.now()
  return {
    label: 'link-child-graph',
    async do(db) {
      const node = await getNodeOrThrow(db, nodeId)
      if (node.childGraphId) throw new Error('Node already has a child graph')
      if (!(await db.graphs.get(graphId))) throw new Error(`Graph ${graphId} not found`)
      priorUpdatedAt = node.updatedAt
      await db.nodes.put({ ...node, childGraphId: graphId, updatedAt: now })
      return [{ type: 'nodes-changed', upserted: [nodeId], removed: [] }]
    },
    async undo(db) {
      // Patch only the pointer: edits made to the node since must survive.
      const node = await db.nodes.get(nodeId)
      if (node) {
        const restored = { ...node, updatedAt: priorUpdatedAt ?? node.updatedAt }
        delete restored.childGraphId
        await db.nodes.put(restored)
      }
      return [{ type: 'nodes-changed', upserted: [nodeId], removed: [] }]
    },
  }
}

export function deleteNodeEverywhere(nodeId: string): Command {
  let captured: {
    node: NodeRecord
    files: FileRecord[]
    placements: PlacementRecord[]
    edges: EdgeRecord[]
  } | null = null
  return {
    label: 'delete-node-everywhere',
    cascade: true,
    async do(db) {
      const node = await getNodeOrThrow(db, nodeId)
      const files = await db.files.where('nodeId').equals(nodeId).toArray()
      const placements = await db.placements.where('nodeId').equals(nodeId).toArray()
      const touching = new Map<string, EdgeRecord>()
      for (const edge of await db.edges.where('fromNodeId').equals(nodeId).toArray()) {
        touching.set(edge.id, edge)
      }
      for (const edge of await db.edges.where('toNodeId').equals(nodeId).toArray()) {
        touching.set(edge.id, edge)
      }
      const edges = [...touching.values()]
      captured = structuredClone({ node, files, placements, edges })
      await db.edges.bulkDelete(edges.map((e) => e.id))
      await db.placements.bulkDelete(placements.map((p) => p.id))
      await db.files.bulkDelete(files.map((f) => f.id))
      await db.nodes.delete(nodeId)
      return [
        { type: 'nodes-changed', upserted: [], removed: [nodeId] },
        { type: 'files-changed', fileIds: files.map((f) => f.id) },
        { type: 'placements-changed', graphIds: placements.map((p) => p.graphId) },
        { type: 'edges-changed', graphIds: [...new Set(edges.map((e) => e.graphId))] },
      ]
    },
    async undo(db) {
      if (!captured) return []
      await db.nodes.put(captured.node)
      await db.files.bulkPut(captured.files)
      await db.placements.bulkPut(captured.placements)
      await db.edges.bulkPut(captured.edges)
      return [
        { type: 'nodes-changed', upserted: [nodeId], removed: [] },
        { type: 'files-changed', fileIds: captured.files.map((f) => f.id) },
        { type: 'placements-changed', graphIds: captured.placements.map((p) => p.graphId) },
        { type: 'edges-changed', graphIds: [...new Set(captured.edges.map((e) => e.graphId))] },
      ]
    },
  }
}

/** Delete several nodes everywhere as ONE undo step. cascade:true — destructive. */
export function deleteNodesEverywhere(nodeIds: string[]): Command {
  return composite(
    'delete-nodes-everywhere',
    async (run) => {
      for (const nodeId of nodeIds) await run(deleteNodeEverywhere(nodeId))
    },
    { cascade: true },
  )
}
