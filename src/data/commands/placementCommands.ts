import type { EdgeRecord, PlacementRecord } from '../types'
import { PlacementExistsError } from './integrity'
import type { Command } from './types'

export interface AddPlacementCommand extends Command {
  placementId: string
}

export function addPlacement(
  graphId: string,
  nodeId: string,
  x: number,
  y: number,
): AddPlacementCommand {
  const placementId = crypto.randomUUID()
  const now = Date.now()
  return {
    label: 'add-placement',
    placementId,
    async do(db) {
      const existing = await db.placements.get({ graphId, nodeId })
      if (existing) throw new PlacementExistsError(existing.id)
      await db.placements.add({ id: placementId, graphId, nodeId, x, y, createdAt: now, updatedAt: now })
      return [{ type: 'placements-changed', graphIds: [graphId] }]
    },
    async undo(db) {
      await db.placements.delete(placementId)
      return [{ type: 'placements-changed', graphIds: [graphId] }]
    },
  }
}

export interface PlacementMove {
  placementId: string
  x: number
  y: number
}

export function movePlacements(moves: PlacementMove[]): Command {
  let captured: PlacementRecord[] = []
  const now = Date.now()
  return {
    label: 'move-placements',
    async do(db) {
      const rows = await db.placements.bulkGet(moves.map((m) => m.placementId))
      const updated: PlacementRecord[] = []
      captured = []
      for (const [i, row] of rows.entries()) {
        const move = moves[i]
        if (!row || !move) continue
        captured.push(structuredClone(row))
        updated.push({ ...row, x: move.x, y: move.y, updatedAt: now })
      }
      await db.placements.bulkPut(updated)
      return [{ type: 'placements-changed', graphIds: [...new Set(updated.map((p) => p.graphId))] }]
    },
    async undo(db) {
      await db.placements.bulkPut(captured)
      return [{ type: 'placements-changed', graphIds: [...new Set(captured.map((p) => p.graphId))] }]
    },
  }
}

/**
 * The canvas Delete gesture: removes placements (cascading edges in that graph
 * touching those nodes) plus any explicitly selected edges, as one undo step.
 * Nodes always survive (§3).
 */
export function removeFromCanvas(placementIds: string[], edgeIds: string[] = []): Command {
  let captured: { placements: PlacementRecord[]; edges: EdgeRecord[] } | null = null
  return {
    label: 'remove-from-canvas',
    cascade: true,
    async do(db) {
      const placements = (await db.placements.bulkGet(placementIds)).filter(
        (p): p is PlacementRecord => p !== undefined,
      )
      const doomed = new Map<string, EdgeRecord>()
      for (const edge of (await db.edges.bulkGet(edgeIds)).filter(
        (e): e is EdgeRecord => e !== undefined,
      )) {
        doomed.set(edge.id, edge)
      }
      for (const placement of placements) {
        const touching = await db.edges
          .where('graphId')
          .equals(placement.graphId)
          .filter((e) => e.fromNodeId === placement.nodeId || e.toNodeId === placement.nodeId)
          .toArray()
        for (const edge of touching) doomed.set(edge.id, edge)
      }
      const edges = [...doomed.values()]
      captured = structuredClone({ placements, edges })
      await db.edges.bulkDelete(edges.map((e) => e.id))
      await db.placements.bulkDelete(placements.map((p) => p.id))
      const graphIds = [...new Set([...placements, ...edges].map((r) => r.graphId))]
      return [
        { type: 'placements-changed', graphIds },
        { type: 'edges-changed', graphIds },
      ]
    },
    async undo(db) {
      if (!captured) return []
      await db.placements.bulkPut(captured.placements)
      await db.edges.bulkPut(captured.edges)
      const graphIds = [
        ...new Set([...captured.placements, ...captured.edges].map((r) => r.graphId)),
      ]
      return [
        { type: 'placements-changed', graphIds },
        { type: 'edges-changed', graphIds },
      ]
    },
  }
}
