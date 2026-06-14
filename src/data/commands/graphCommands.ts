import { getMeta } from '../db'
import { placementsByGraph, placementsOfNode } from '../queries'
import type { EdgeRecord, GraphRecord, PlacementRecord } from '../types'
import { composite } from './composite'
import { HomeDeletionError } from './integrity'
import { deleteNodeEverywhere } from './nodeCommands'
import type { Command } from './types'

export interface CreateGraphCommand extends Command {
  graphId: string
}

export function createGraph(name: string): CreateGraphCommand {
  const graphId = crypto.randomUUID()
  const now = Date.now()
  return {
    label: 'create-graph',
    graphId,
    async do(db) {
      await db.graphs.add({ id: graphId, name, createdAt: now, updatedAt: now })
      return [{ type: 'graphs-changed', upserted: [graphId], removed: [] }]
    },
    async undo(db) {
      await db.graphs.delete(graphId)
      return [{ type: 'graphs-changed', upserted: [], removed: [graphId] }]
    },
  }
}

export function renameGraph(graphId: string, name: string): Command {
  let captured: GraphRecord | null = null
  const now = Date.now()
  return {
    label: 'rename-graph',
    async do(db) {
      const graph = await db.graphs.get(graphId)
      if (!graph) throw new Error(`Graph ${graphId} not found`)
      captured = structuredClone(graph)
      await db.graphs.put({ ...graph, name, updatedAt: now })
      return [{ type: 'graphs-changed', upserted: [graphId], removed: [] }]
    },
    async undo(db) {
      if (captured) await db.graphs.put(captured)
      return [{ type: 'graphs-changed', upserted: [graphId], removed: [] }]
    },
  }
}

export function deleteGraph(graphId: string): Command {
  let captured: {
    graph: GraphRecord
    placements: PlacementRecord[]
    edges: EdgeRecord[]
    // Pointer fields only: title/payload edits made after the delete must
    // survive a structural undo (§6/§8).
    referringNodes: { id: string; updatedAt: number }[]
  } | null = null
  const now = Date.now()
  return {
    label: 'delete-graph',
    cascade: true,
    async do(db) {
      if ((await getMeta<string>(db, 'homeGraphId')) === graphId) throw new HomeDeletionError()
      const graph = await db.graphs.get(graphId)
      if (!graph) throw new Error(`Graph ${graphId} not found`)
      const placements = await db.placements.where('graphId').equals(graphId).toArray()
      const edges = await db.edges.where('graphId').equals(graphId).toArray()
      const referringNodes = await db.nodes.where('childGraphId').equals(graphId).toArray()
      captured = structuredClone({
        graph,
        placements,
        edges,
        referringNodes: referringNodes.map((n) => ({ id: n.id, updatedAt: n.updatedAt })),
      })
      await db.edges.bulkDelete(edges.map((e) => e.id))
      await db.placements.bulkDelete(placements.map((p) => p.id))
      await db.nodes.bulkPut(
        referringNodes.map((node) => {
          const cleared = { ...node, updatedAt: now }
          delete cleared.childGraphId
          return cleared
        }),
      )
      await db.graphs.delete(graphId)
      return [
        { type: 'graphs-changed', upserted: [], removed: [graphId] },
        { type: 'placements-changed', graphIds: [graphId] },
        { type: 'edges-changed', graphIds: [graphId] },
        { type: 'nodes-changed', upserted: referringNodes.map((n) => n.id), removed: [] },
      ]
    },
    async undo(db) {
      if (!captured) return []
      await db.graphs.put(captured.graph)
      await db.placements.bulkPut(captured.placements)
      await db.edges.bulkPut(captured.edges)
      const rows = await db.nodes.bulkGet(captured.referringNodes.map((n) => n.id))
      await db.nodes.bulkPut(
        rows.flatMap((row, i) => {
          const cap = captured?.referringNodes[i]
          return row && cap ? [{ ...row, childGraphId: graphId, updatedAt: cap.updatedAt }] : []
        }),
      )
      return [
        { type: 'graphs-changed', upserted: [graphId], removed: [] },
        { type: 'placements-changed', graphIds: [graphId] },
        { type: 'edges-changed', graphIds: [graphId] },
        { type: 'nodes-changed', upserted: captured.referringNodes.map((n) => n.id), removed: [] },
      ]
    },
  }
}

/**
 * Delete a graph AND every node placed only in it, as ONE undo step. A node
 * placed in another graph survives (only its placement here is dropped by
 * deleteGraph). Home is never deletable — deleteGraph throws HomeDeletionError.
 * Composite shape mirrors server/graphSource.ts: run in order, undo in reverse.
 */
export function deleteGraphDeep(graphId: string): Command {
  return composite(
    'delete-graph-deep',
    async (run) => {
      // Capture nodes exclusively placed in this graph BEFORE deleteGraph drops
      // their placements (afterwards they'd look unplaced everywhere).
      const placements = await placementsByGraph(graphId)
      const exclusive: string[] = []
      for (const nodeId of new Set(placements.map((p) => p.nodeId))) {
        const all = await placementsOfNode(nodeId)
        if (all.every((p) => p.graphId === graphId)) exclusive.push(nodeId)
      }
      await run(deleteGraph(graphId))
      for (const nodeId of exclusive) await run(deleteNodeEverywhere(nodeId))
    },
    { cascade: true },
  )
}
