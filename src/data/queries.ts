import { getDb, getMeta } from './db'
import type { EdgeRecord, GraphRecord, NodeRecord, PlacementRecord } from './types'

export function placementsByGraph(graphId: string): Promise<PlacementRecord[]> {
  return getDb().placements.where('graphId').equals(graphId).toArray()
}

export function edgesByGraph(graphId: string): Promise<EdgeRecord[]> {
  return getDb().edges.where('graphId').equals(graphId).toArray()
}

export function placementsOfNode(nodeId: string): Promise<PlacementRecord[]> {
  return getDb().placements.where('nodeId').equals(nodeId).toArray()
}

export interface AppearsIn {
  graphs: { graph: GraphRecord; placement: PlacementRecord }[]
  parentNodes: NodeRecord[]
}

/**
 * §4 "appears in": every graph holding a placement of the node, and every node
 * whose child graph contains it.
 */
export async function appearsIn(nodeId: string): Promise<AppearsIn> {
  const db = getDb()
  const placements = await db.placements.where('nodeId').equals(nodeId).toArray()
  const graphIds = placements.map((p) => p.graphId)
  const graphs = await db.graphs.bulkGet(graphIds)
  const entries = placements.flatMap((placement, i) => {
    const graph = graphs[i]
    return graph ? [{ graph, placement }] : []
  })
  const parentNodes = graphIds.length
    ? await db.nodes.where('childGraphId').anyOf(graphIds).toArray()
    : []
  return { graphs: entries, parentNodes }
}

export interface LooseEnds {
  unreferencedGraphs: GraphRecord[]
  unplacedNodes: NodeRecord[]
}

/** §3 loose ends: graphs no node points at, nodes with zero placements. */
export async function looseEnds(): Promise<LooseEnds> {
  const db = getDb()
  const homeGraphId = await getMeta<string>(db, 'homeGraphId')
  const placed = new Set(await db.placements.orderBy('nodeId').uniqueKeys())
  // A childGraphId counts as a reference only when its owning node is itself
  // placed — an unplaced pointer can't reach its child graph from any canvas,
  // so that graph must surface here or it has no rename/delete/open path.
  const referencingNodes = await db.nodes
    .filter((n) => !!n.childGraphId && placed.has(n.id))
    .toArray()
  const referenced = new Set(referencingNodes.map((n) => n.childGraphId))
  const unreferencedGraphs = await db.graphs
    .filter((g) => !referenced.has(g.id) && g.id !== homeGraphId)
    .toArray()
  const unplacedNodes = await db.nodes.filter((n) => !placed.has(n.id)).toArray()
  return { unreferencedGraphs, unplacedNodes }
}

export function relationTypeUsage(relationTypeId: string): Promise<number> {
  return getDb().edges.where('relationTypeId').equals(relationTypeId).count()
}

export function kindUsage(kindId: string): Promise<number> {
  return getDb()
    .nodes.filter((n) => n.kindId === kindId)
    .count()
}
