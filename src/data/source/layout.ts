import type { PlacementRecord } from '../types'

const COL_WIDTH = 220
const ROW_HEIGHT = 140
const COLUMNS = 4
const GAP = 80

/**
 * A deterministic grid below the existing bounding box for nodes minted from
 * source. New nodes have no coordinates in the DSL, so we lay them out in a
 * stable order keyed on their index among the new arrivals.
 */
export function nextPlacementPosition(
  existing: PlacementRecord[],
  indexAmongNew: number,
): { x: number; y: number } {
  const baseX = existing.length ? Math.min(...existing.map((p) => p.x)) : 0
  const bottom = existing.length ? Math.max(...existing.map((p) => p.y)) : 0
  const startY = existing.length ? bottom + ROW_HEIGHT + GAP : 0
  const col = indexAmongNew % COLUMNS
  const row = Math.floor(indexAmongNew / COLUMNS)
  return { x: baseX + col * COL_WIDTH, y: startY + row * ROW_HEIGHT }
}
