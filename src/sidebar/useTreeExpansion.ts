import { useState } from 'react'
import { toggleInSet } from './setUtil'
import type { TreeCtl } from './TreeRows'

/**
 * Tree expansion state shared by the graph and files trees: the `expanded` Set,
 * a `toggle`, and the navigation-following reconciliation (ancestors of the
 * current trail unfold). State adjusted during render — the
 * you-might-not-need-an-effect pattern.
 */
export function useTreeExpansion(trail: string[]): TreeCtl {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  const [openedForTrail, setOpenedForTrail] = useState<string[]>([])
  if (openedForTrail !== trail) {
    setOpenedForTrail(trail)
    const next = new Set(expanded)
    trail.forEach((_, i) => next.add(trail.slice(0, i + 1).join('/')))
    setExpanded(next)
  }

  const toggle = (key: string) => setExpanded((prev) => toggleInSet(prev, key))

  return { expanded, toggle }
}
