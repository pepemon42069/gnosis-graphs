import type { XY } from '../app/types'

const CARD_WIDTH = 260
const CARD_HEIGHT = 88
const STEP = 24
const MAX_STEPS = 20

/** New placements spawn at the requested point, nudged diagonally off occupied cards (§5). */
export function nudgePosition(desired: XY, occupied: XY[]): XY {
  let pos = desired
  for (let i = 0; i < MAX_STEPS; i++) {
    const collides = occupied.some(
      (p) => Math.abs(pos.x - p.x) < CARD_WIDTH && Math.abs(pos.y - p.y) < CARD_HEIGHT,
    )
    if (!collides) break
    pos = { x: pos.x + STEP, y: pos.y + STEP }
  }
  return pos
}
