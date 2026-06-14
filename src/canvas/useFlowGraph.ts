import {
  applyNodeChanges,
  type NodeChange,
  type OnEdgesChange,
  type OnNodeDrag,
  type OnNodesChange,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSessionStore } from '../app/store'
import type { XY } from '../app/types'
import { runCommand, useGraphData } from '../data/client'
import { useContentStore } from '../data/react/contentStore'
import type { PlacementRecord } from '../data/types'
import { useThemePreference, type Theme } from '../settings/theme'
import { mapEdges, reconcileNodes, type CardNode, type RelationEdgeType } from './flowMapping'

/**
 * The live --muted token as a concrete value — an SVG arrowhead fill can't
 * reference a CSS var. Reading computed style already reflects the active theme;
 * `theme` is the input that makes callers re-resolve when the token swaps, and
 * picks the matching fallback for the (rare) pre-paint empty read.
 */
function mutedColor(theme: Theme): string {
  const light = theme === 'light' || (theme === 'system' && matchMedia('(prefers-color-scheme: light)').matches)
  return getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || (light ? '#6b6470' : '#8b8fa6')
}

type PlacementMove = { placementId: string; x: number; y: number }

export interface FlowGraph {
  nodes: CardNode[]
  edges: RelationEdgeType[]
  onNodesChange: OnNodesChange<CardNode>
  onEdgesChange: OnEdgesChange<RelationEdgeType>
  onNodeDragStart: OnNodeDrag<CardNode>
  onNodeDragStop: OnNodeDrag<CardNode>
  placementOf(nodeId: string): PlacementRecord | undefined
  /** true only after placements have loaded — undefined-while-loading never counts. */
  isEmpty: boolean
}

/**
 * The Dexie ⇄ React Flow seam. Local state is truth in motion, the DB at rest:
 * drags never write per-tick, drag-end dispatches one movePlacements, and
 * reconcile absorbs liveQuery echoes without ever snapping a node back.
 * Selection lives in the session store; reconcile derives the flags.
 *
 * The consumer must remount on graph change (key={graphId}) — all local state
 * here is per-graph.
 */
export function useFlowGraph(graphId: string): FlowGraph {
  const [nodes, setNodes] = useState<CardNode[]>([])
  const draggingIds = useRef(new Set<string>())
  const pendingMoves = useRef(new Map<string, XY>())
  const placementByNode = useRef(new Map<string, PlacementRecord>())

  const { placements, edges: edgeRecords } = useGraphData(graphId)
  const selection = useSessionStore((s) => s.selection)
  const tagFilter = useSessionStore((s) => s.tagFilter)
  const relationTypes = useContentStore((s) => s.relationTypes)
  const contentNodes = useContentStore((s) => s.nodes)
  const theme = useThemePreference()

  // Tag filter (OR): with no filter every placement shows; otherwise only nodes
  // carrying any selected tag. Edges to hidden nodes are dropped (React Flow won't).
  const visiblePlacements = useMemo(() => {
    if (!tagFilter.length) return placements
    const wanted = new Set(tagFilter)
    return placements.filter((p) => contentNodes.get(p.nodeId)?.tags?.some((t) => wanted.has(t)))
  }, [placements, tagFilter, contentNodes])
  const visibleNodeIds = useMemo(() => new Set(visiblePlacements.map((p) => p.nodeId)), [visiblePlacements])

  useEffect(() => {
    placementByNode.current = new Map(placements.map((p) => [p.nodeId, p]))
    setNodes((prev) =>
      reconcileNodes(prev, visiblePlacements, {
        draggingIds: draggingIds.current,
        pendingMoves: pendingMoves.current,
        selectedNodeIds: new Set(selection.nodeIds),
      }),
    )
  }, [placements, visiblePlacements, selection.nodeIds])

  const edges = useMemo(
    () =>
      mapEdges(
        tagFilter.length
          ? edgeRecords.filter((e) => visibleNodeIds.has(e.fromNodeId) && visibleNodeIds.has(e.toNodeId))
          : edgeRecords,
        new Set(selection.edgeIds),
        relationTypes,
        mutedColor(theme),
      ),
    [edgeRecords, visibleNodeIds, tagFilter.length, selection.edgeIds, relationTypes, theme],
  )

  const onNodesChange = useCallback<OnNodesChange<CardNode>>((changes) => {
    const rest = changes.filter((c) => c.type !== 'select')
    if (rest.length) setNodes((prev) => applyNodeChanges(rest as NodeChange<CardNode>[], prev))
    const selectChanges = changes.filter((c) => c.type === 'select')
    if (selectChanges.length) {
      const store = useSessionStore.getState()
      const ids = new Set(store.selection.nodeIds)
      for (const c of selectChanges) {
        if (c.selected) ids.add(c.id)
        else ids.delete(c.id)
      }
      store.setSelection({ nodeIds: [...ids], edgeIds: store.selection.edgeIds })
    }
  }, [])

  const onEdgesChange = useCallback<OnEdgesChange<RelationEdgeType>>((changes) => {
    const selectChanges = changes.filter((c) => c.type === 'select')
    if (!selectChanges.length) return
    const store = useSessionStore.getState()
    const ids = new Set(store.selection.edgeIds)
    for (const c of selectChanges) {
      if (c.selected) ids.add(c.id)
      else ids.delete(c.id)
    }
    store.setSelection({ nodeIds: store.selection.nodeIds, edgeIds: [...ids] })
  }, [])

  const onNodeDragStart = useCallback<OnNodeDrag<CardNode>>((_event, _node, dragged) => {
    for (const n of dragged) draggingIds.current.add(n.id)
  }, [])

  const onNodeDragStop = useCallback<OnNodeDrag<CardNode>>((_event, _node, dragged) => {
    draggingIds.current.clear()
    const moves: PlacementMove[] = []
    for (const n of dragged) {
      const placement = placementByNode.current.get(n.id)
      if (!placement || (placement.x === n.position.x && placement.y === n.position.y)) continue
      pendingMoves.current.set(placement.id, { x: n.position.x, y: n.position.y })
      moves.push({ placementId: placement.id, x: n.position.x, y: n.position.y })
    }
    if (!moves.length) return
    // The success echo clears each pendingMove and the node stays put; a rejection
    // leaves the node stranded ahead of the DB, so drop the optimistic entries and
    // snap back to the authoritative placements.
    runCommand('move-placements', { moves }).catch(() => {
      for (const m of moves) pendingMoves.current.delete(m.placementId)
      setNodes((prev) =>
        prev.map((node) => {
          const placement = placementByNode.current.get(node.id)
          if (!placement || (node.position.x === placement.x && node.position.y === placement.y)) return node
          return { ...node, position: { x: placement.x, y: placement.y } }
        }),
      )
    })
  }, [])

  const placementOf = useCallback((nodeId: string) => placementByNode.current.get(nodeId), [])

  return {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onNodeDragStart,
    onNodeDragStop,
    placementOf,
    isEmpty: placements.length === 0,
  }
}
