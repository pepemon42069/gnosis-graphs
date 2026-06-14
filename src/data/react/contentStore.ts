import { create } from 'zustand'
import type { GraphRecord, KindRecord, NodeRecord, RelationTypeRecord } from '../types'

interface ContentState {
  nodes: Map<string, NodeRecord>
  kinds: Map<string, KindRecord>
  relationTypes: Map<string, RelationTypeRecord>
  graphs: Map<string, GraphRecord>
  setNodes(rows: NodeRecord[]): void
  setKinds(rows: KindRecord[]): void
  setRelationTypes(rows: RelationTypeRecord[]): void
  setGraphs(rows: GraphRecord[]): void
}

/**
 * liveQuery re-reads produce fresh objects every emission; reusing the previous
 * object when updatedAt is unchanged keeps reference equality, so per-id
 * selector subscribers (node cards) only re-render for rows that actually changed.
 */
function mergeById<T extends { id: string; updatedAt: number }>(
  prev: Map<string, T>,
  rows: T[],
): Map<string, T> {
  const next = new Map<string, T>()
  for (const row of rows) {
    const old = prev.get(row.id)
    next.set(row.id, old && old.updatedAt === row.updatedAt ? old : row)
  }
  return next
}

export const useContentStore = create<ContentState>()((set) => ({
  nodes: new Map(),
  kinds: new Map(),
  relationTypes: new Map(),
  graphs: new Map(),
  setNodes: (rows) => set((s) => ({ nodes: mergeById(s.nodes, rows) })),
  setKinds: (rows) => set((s) => ({ kinds: mergeById(s.kinds, rows) })),
  setRelationTypes: (rows) => set((s) => ({ relationTypes: mergeById(s.relationTypes, rows) })),
  setGraphs: (rows) => set((s) => ({ graphs: mergeById(s.graphs, rows) })),
}))
