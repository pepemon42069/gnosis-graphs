import { useReactFlow } from '@xyflow/react'
import { useCallback, useState } from 'react'
import { useSessionStore } from '../app/store'
import type { XY } from '../app/types'
import { fetchGraphData, runCommand } from '../data/client'
import { type LayoutStyle, elkLayout } from '../data/graphLayout'
import type { EdgeRecord, PlacementRecord } from '../data/types'

type PlacementMove = { placementId: string; x: number; y: number }

const FALLBACK_WIDTH = 200
const FALLBACK_HEIGHT = 56

export interface TidyScope {
  placements: PlacementRecord[]
  edges: EdgeRecord[]
}

/**
 * Any active selection scopes Tidy to the induced subgraph (§5: "only the
 * selected nodes are laid out; everything else stays put" — a single selected
 * node is a no-op, never a whole-graph layout). Self-edges and edges touching
 * nodes outside the scope carry no layout information.
 */
export function tidyScope(
  placements: PlacementRecord[],
  edges: EdgeRecord[],
  selectedNodeIds: readonly string[],
): TidyScope {
  const selected = new Set(selectedNodeIds)
  const scoped = selected.size >= 1 ? placements.filter((p) => selected.has(p.nodeId)) : placements
  const placed = new Set(scoped.map((p) => p.nodeId))
  return {
    placements: scoped,
    edges: edges.filter(
      (e) => e.fromNodeId !== e.toNodeId && placed.has(e.fromNodeId) && placed.has(e.toNodeId),
    ),
  }
}

export function boundingBoxOrigin(points: readonly XY[]): XY {
  let x = Infinity
  let y = Infinity
  for (const p of points) {
    x = Math.min(x, p.x)
    y = Math.min(y, p.y)
  }
  return { x, y }
}

export interface LaidOutNode extends XY {
  id: string
}

/** Shifts laid-out coordinates so their bounding-box top-left lands on `origin`. */
export function translateToOrigin(nodes: readonly LaidOutNode[], origin: XY): LaidOutNode[] {
  const current = boundingBoxOrigin(nodes)
  const dx = origin.x - current.x
  const dy = origin.y - current.y
  return nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy }))
}

/**
 * §5 Tidy: one-shot elk auto-layout over the current graph (or the selected
 * cluster) in the chosen style (web/flow), dispatched as a single movePlacements
 * so one Mod+Z restores the previous layout exactly. A whole-graph tidy fits the
 * result to view; a selection tidy keeps it in place. elk loads lazily (via the
 * shared helper) — it never rides the main chunk.
 */
export function useTidy(graphId: string): {
  tidy(style: LayoutStyle): Promise<void>
  running: boolean
} {
  const [running, setRunning] = useState(false)
  const { getNodes, fitBounds } = useReactFlow()

  const tidy = useCallback(
    async (style: LayoutStyle) => {
      if (running) return
      setRunning(true)
      try {
        const { placements, edges } = await fetchGraphData(graphId)
        const selectedNodeIds = useSessionStore.getState().selection.nodeIds
        const scope = tidyScope(placements, edges, selectedNodeIds)
        if (!scope.placements.length) return

        const measured = new Map(getNodes().map((n) => [n.id, n.measured]))
        const nodes = scope.placements.map((p) => ({
          id: p.nodeId,
          width: measured.get(p.nodeId)?.width ?? FALLBACK_WIDTH,
          height: measured.get(p.nodeId)?.height ?? FALLBACK_HEIGHT,
        }))
        const sizeById = new Map(nodes.map((n) => [n.id, n]))
        const positions = await elkLayout(
          { nodes, edges: scope.edges.map((e) => ({ id: e.id, source: e.fromNodeId, target: e.toNodeId })) },
          style,
        )

        let laidOut: LaidOutNode[] = [...positions].map(([id, p]) => ({ id, x: p.x, y: p.y }))
        if (selectedNodeIds.length >= 1) {
          laidOut = translateToOrigin(laidOut, boundingBoxOrigin(scope.placements))
        }

        // The elk await can outlive a graph switch — never move placements in a
        // graph the user has navigated away from.
        if (useSessionStore.getState().graphId !== graphId) return

        const placementByNode = new Map(scope.placements.map((p) => [p.nodeId, p]))
        const moves: PlacementMove[] = []
        for (const n of laidOut) {
          const placement = placementByNode.get(n.id)
          if (!placement || (placement.x === n.x && placement.y === n.y)) continue
          moves.push({ placementId: placement.id, x: n.x, y: n.y })
        }
        if (moves.length) await runCommand('move-placements', { moves })

        // Frame the freshly laid-out graph. fitBounds uses the known final
        // coordinates, so it works before the move echo reconciles the nodes. A
        // selection tidy stays put (it was translated back to its origin).
        if (selectedNodeIds.length === 0 && laidOut.length) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
          for (const n of laidOut) {
            const s = sizeById.get(n.id)
            minX = Math.min(minX, n.x)
            minY = Math.min(minY, n.y)
            maxX = Math.max(maxX, n.x + (s?.width ?? 0))
            maxY = Math.max(maxY, n.y + (s?.height ?? 0))
          }
          fitBounds({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }, { padding: 0.12, duration: 400 })
        }
      } finally {
        setRunning(false)
      }
    },
    [graphId, getNodes, fitBounds, running],
  )

  return { tidy, running }
}
