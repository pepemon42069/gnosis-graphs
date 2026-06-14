import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type { XY } from '../app/types'
import type { EdgeRecord, PlacementRecord, RelationTypeRecord } from '../data/types'

export type CardNode = Node<{ nodeId: string }, 'card'>
export type RelationEdgeType = Edge<{ relationTypeId: string }, 'relation'>

export interface ReconcileContext {
  /** Node ids mid-drag: local position owns the gesture, DB emissions never move them. */
  draggingIds: ReadonlySet<string>
  /**
   * placementId → position dispatched at drag end. An emission matching the
   * dispatched value is the echo (entry consumed); a differing one is stale
   * pre-drag data and the local position is kept. Deliberately mutated here.
   */
  pendingMoves: Map<string, XY>
  selectedNodeIds: ReadonlySet<string>
}

export function reconcileNodes(
  prev: CardNode[],
  placements: PlacementRecord[],
  ctx: ReconcileContext,
): CardNode[] {
  const prevById = new Map(prev.map((n) => [n.id, n]))
  let changed = prev.length !== placements.length
  const next = placements.map((p, i) => {
    const existing = prevById.get(p.nodeId)
    if (existing && ctx.draggingIds.has(p.nodeId)) {
      if (existing !== prev[i]) changed = true
      return existing
    }
    let { x, y } = p
    const pending = ctx.pendingMoves.get(p.id)
    if (pending) {
      if (pending.x === p.x && pending.y === p.y) ctx.pendingMoves.delete(p.id)
      else if (existing) ({ x, y } = existing.position)
    }
    const selected = ctx.selectedNodeIds.has(p.nodeId)
    if (
      existing &&
      existing.position.x === x &&
      existing.position.y === y &&
      (existing.selected ?? false) === selected
    ) {
      if (existing !== prev[i]) changed = true
      return existing
    }
    changed = true
    return existing
      ? { ...existing, position: { x, y }, selected }
      : ({ id: p.nodeId, type: 'card' as const, position: { x, y }, data: { nodeId: p.nodeId }, selected })
  })
  return changed ? next : prev
}

export function mapEdges(
  records: EdgeRecord[],
  selectedEdgeIds: ReadonlySet<string>,
  relationTypes: Map<string, RelationTypeRecord>,
  /** Concrete --muted value for the colorless arrowhead — an SVG fill can't take
   *  a CSS var, so resolving it keeps the fallback in step with the stroke's
   *  var(--muted) instead of a theme-blind gray. */
  muted: string,
): RelationEdgeType[] {
  return records.map((r) => ({
    id: r.id,
    source: r.fromNodeId,
    target: r.toNodeId,
    type: 'relation' as const,
    data: { relationTypeId: r.relationTypeId },
    selected: selectedEdgeIds.has(r.id),
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: relationTypes.get(r.relationTypeId)?.color ?? muted,
      width: 18,
      height: 18,
    },
  }))
}
