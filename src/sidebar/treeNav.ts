import { nudgePosition } from '../canvas/spawnPosition'
import { useSessionStore } from '../app/store'
import { fetchGraphData } from '../data/client'
import { visit } from '../nav/history'

/**
 * Bring a node's graph on screen before acting on it: if the canvas isn't the
 * current graph (or a doc page covers it), visit it first. Caller then does the
 * focus/open gesture against the now-visible graph.
 */
export function ensureOnGraph(graphId: string, path: string[]): void {
  const { graphId: current, docNodeId } = useSessionStore.getState()
  if (graphId !== current || docNodeId) visit(graphId, path)
}

/** Content clusters near origin, so nudging off (0,0) finds a free spot. */
export async function freeSpotOnGraph(graphId: string) {
  return nudgePosition({ x: 0, y: 0 }, (await fetchGraphData(graphId)).placements)
}
