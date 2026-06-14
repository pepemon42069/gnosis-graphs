import type { EdgeRecord } from '../types'
import type { Command } from './types'

export interface CreateEdgeOptions {
  graphId: string
  fromNodeId: string
  toNodeId: string
  relationTypeId: string
}

export interface CreateEdgeCommand extends Command {
  edgeId: string
}

export function createEdge(opts: CreateEdgeOptions): CreateEdgeCommand {
  const edgeId = crypto.randomUUID()
  const now = Date.now()
  return {
    label: 'create-edge',
    edgeId,
    async do(db) {
      await db.edges.add({ id: edgeId, ...opts, createdAt: now, updatedAt: now })
      return [{ type: 'edges-changed', graphIds: [opts.graphId] }]
    },
    async undo(db) {
      await db.edges.delete(edgeId)
      return [{ type: 'edges-changed', graphIds: [opts.graphId] }]
    },
  }
}

export function deleteEdges(edgeIds: string[]): Command {
  let captured: EdgeRecord[] = []
  return {
    label: 'delete-edges',
    async do(db) {
      captured = structuredClone(
        (await db.edges.bulkGet(edgeIds)).filter((e): e is EdgeRecord => e !== undefined),
      )
      await db.edges.bulkDelete(captured.map((e) => e.id))
      return [{ type: 'edges-changed', graphIds: [...new Set(captured.map((e) => e.graphId))] }]
    },
    async undo(db) {
      await db.edges.bulkPut(captured)
      return [{ type: 'edges-changed', graphIds: [...new Set(captured.map((e) => e.graphId))] }]
    },
  }
}

/** Capture-put-restore for a single edge edit (reverse, retype). */
function editEdge(
  label: string,
  edgeId: string,
  patch: (edge: EdgeRecord) => Partial<EdgeRecord>,
): Command {
  let captured: EdgeRecord | null = null
  const now = Date.now()
  return {
    label,
    async do(db) {
      const edge = await db.edges.get(edgeId)
      if (!edge) throw new Error(`Edge ${edgeId} not found`)
      captured = structuredClone(edge)
      await db.edges.put({ ...edge, ...patch(edge), updatedAt: now })
      return [{ type: 'edges-changed', graphIds: [edge.graphId] }]
    },
    async undo(db) {
      if (captured) await db.edges.put(captured)
      return [{ type: 'edges-changed', graphIds: captured ? [captured.graphId] : [] }]
    },
  }
}

/** Flip the relationship's direction by swapping its endpoints. */
export function reverseEdge(edgeId: string): Command {
  return editEdge('reverse-edge', edgeId, (edge) => ({
    fromNodeId: edge.toNodeId,
    toNodeId: edge.fromNodeId,
  }))
}

export function retypeEdge(edgeId: string, relationTypeId: string): Command {
  return editEdge('retype-edge', edgeId, () => ({ relationTypeId }))
}
