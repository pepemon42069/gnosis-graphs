// Shared graph auto-layout: wraps elkjs so both the client Tidy button and the
// server's decompose path lay out a graph with the same tuned presets. Pure — no
// DB import (honors the layering rule). elk loads lazily (never the main chunk).

import type { ElkExtendedEdge } from 'elkjs/lib/elk-api'

export type LayoutStyle = 'flow' | 'web'

export interface LayoutNode {
  id: string
  width: number
  height: number
  /** Used only for soft tag-clustering (see elkLayout's `cluster`). */
  tags?: string[]
}
export interface LayoutEdge {
  id: string
  source: string
  target: string
}
export interface Point {
  x: number
  y: number
}

/** The two styles the layout lab picked over a dense 74-node concept graph:
 *  - flow: elk `layered` (left→right hierarchy) with generous, node-size-aware
 *    spacing + orthogonal routing — shows dependency direction.
 *  - web: elk `stress` (organic/compact, near-square, fewest crossings) + an
 *    overlap-removal pass (stress doesn't separate node boxes itself). */
const LAYOUTS: Record<LayoutStyle, Record<string, string>> = {
  flow: {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    // In RIGHT layered, nodeNode is the *vertical* gap within a column — kept
    // generous; betweenLayers is the horizontal gap between columns.
    'elk.spacing.nodeNode': '100',
    'elk.layered.spacing.nodeNodeBetweenLayers': '110',
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.layered.spacing.edgeNodeBetweenLayers': '40',
  },
  web: {
    'elk.algorithm': 'stress',
    'elk.stress.desiredEdgeLength': '300',
    'elk.spacing.nodeNode': '120',
  },
}

// Same-tag nodes laid out by `web` are pulled together by extra "affinity" edges
// with a slightly shorter desired length than the general spread (300), so clusters
// read clearly without collapsing into a clump.
const AFFINITY_EDGE_LENGTH = '280'
// A tag shared by more than this many nodes isn't a meaningful cluster — skip it
// (it would otherwise pull most of the graph into one clump).
const MAX_CLUSTER_SIZE = 12

export const DEFAULT_LAYOUT: LayoutStyle = 'web'

const FALLBACK_WIDTH = 200
const FALLBACK_HEIGHT = 56
// Min gap enforced between node boxes after layout — anisotropic: a larger
// vertical gap keeps rows from crowding (node cards are wider than tall).
const OVERLAP_MARGIN_X = 55
const OVERLAP_MARGIN_Y = 60

/**
 * Estimate a node-card's rendered size from its content (the client passes real
 * React Flow `measured` sizes and uses this only as a fallback; the server has no
 * DOM, so it always estimates). Width is clamped to the `.node-card` 140–320 band.
 */
export function estimateNodeSize(
  title: string,
  hasTags: boolean,
  hasSummary: boolean,
): { width: number; height: number } {
  const width = Math.max(140, Math.min(320, Math.round((title?.length ?? 4) * 7.2) + 28))
  const height = 40 + (hasTags ? 18 : 0) + (hasSummary ? 34 : 0)
  return { width, height }
}

interface Placed extends LayoutNode, Point {}

/**
 * Push overlapping boxes apart along their axis of least penetration until every
 * pair is separated by >= margin. A no-op on already-clean layouts (layered); the
 * cure for stress, which optimizes edge length and lets boxes overlap.
 */
export function removeOverlaps(
  nodes: Placed[],
  marginX = OVERLAP_MARGIN_X,
  marginY = OVERLAP_MARGIN_Y,
  passes = 400,
): Placed[] {
  for (let pass = 0; pass < passes; pass++) {
    let moved = false
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!
        const b = nodes[j]!
        const dx = a.x + a.width / 2 - (b.x + b.width / 2)
        const dy = a.y + a.height / 2 - (b.y + b.height / 2)
        const px = (a.width + b.width) / 2 + marginX - Math.abs(dx)
        const py = (a.height + b.height) / 2 + marginY - Math.abs(dy)
        if (px > 0 && py > 0) {
          moved = true
          if (px < py) {
            const s = ((dx < 0 ? -1 : 1) * px) / 2
            a.x += s
            b.x -= s
          } else {
            const s = ((dy < 0 ? -1 : 1) * py) / 2
            a.y += s
            b.y -= s
          }
        }
      }
    }
    if (!moved) break
  }
  return nodes
}

/** Layout-only edges that pull same-tag nodes together (web/stress clustering). For
 *  each tag, star-connect its nodes to the first member; skip non-clusters (1 node)
 *  and over-broad tags (> MAX_CLUSTER_SIZE). */
function tagAffinityEdges(nodes: LayoutNode[]): ElkExtendedEdge[] {
  const byTag = new Map<string, string[]>()
  for (const n of nodes) {
    for (const tag of n.tags ?? []) {
      const ids = byTag.get(tag) ?? []
      ids.push(n.id)
      byTag.set(tag, ids)
    }
  }
  const edges: ElkExtendedEdge[] = []
  for (const [tag, ids] of byTag) {
    if (ids.length < 2 || ids.length > MAX_CLUSTER_SIZE) continue
    const hub = ids[0]!
    for (let i = 1; i < ids.length; i++) {
      edges.push({
        id: `aff:${tag}:${i}`,
        sources: [hub],
        targets: [ids[i]!],
        layoutOptions: { 'org.eclipse.elk.stress.desiredEdgeLength': AFFINITY_EDGE_LENGTH },
      })
    }
  }
  return edges
}

/** Lay out a graph with the given style; returns a nodeId → {x,y} top-left map.
 *  `cluster` adds soft tag-attraction (only meaningful for the `web`/stress style). */
export async function elkLayout(
  graph: { nodes: LayoutNode[]; edges: LayoutEdge[] },
  style: LayoutStyle = DEFAULT_LAYOUT,
  cluster = false,
): Promise<Map<string, Point>> {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
  const sized = new Map(graph.nodes.map((n) => [n.id, n]))
  const edges: ElkExtendedEdge[] = graph.edges.map((e) => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target],
  }))
  if (cluster && style === 'web') edges.push(...tagAffinityEdges(graph.nodes))
  const result = await new ELK().layout({
    id: 'root',
    layoutOptions: LAYOUTS[style],
    children: graph.nodes.map((n) => ({ id: n.id, width: n.width, height: n.height })),
    edges,
  })
  const placed: Placed[] = (result.children ?? []).map((c) => ({
    id: c.id,
    x: c.x ?? 0,
    y: c.y ?? 0,
    width: sized.get(c.id)?.width ?? FALLBACK_WIDTH,
    height: sized.get(c.id)?.height ?? FALLBACK_HEIGHT,
  }))
  removeOverlaps(placed)
  return new Map(placed.map((n) => [n.id, { x: n.x, y: n.y }]))
}
