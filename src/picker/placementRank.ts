import { fetchAppearsIn } from '../data/client'
import type { PlacementRecord } from '../data/types'

/**
 * §7 jump ranking: session recency first (MRU index), then graph updatedAt.
 * Returns placements best-first alongside their graph names for display.
 */
export async function rankedPlacements(
  nodeId: string,
  recentGraphIds: string[],
): Promise<{ placement: PlacementRecord; graphName: string }[]> {
  const appears = await fetchAppearsIn(nodeId)
  const sorted = [...appears.graphs].sort((a, b) => {
    const ra = recentGraphIds.indexOf(a.placement.graphId)
    const rb = recentGraphIds.indexOf(b.placement.graphId)
    if (ra !== -1 || rb !== -1) return (ra === -1 ? Infinity : ra) - (rb === -1 ? Infinity : rb)
    return b.graph.updatedAt - a.graph.updatedAt
  })
  return sorted.map(({ placement, graph }) => ({ placement, graphName: graph.name }))
}
