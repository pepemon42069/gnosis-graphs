import { useState } from 'react'
import { useSessionStore } from '../app/store'
import './nav.css'

type DrillDirection = 'drill-in' | 'drill-out' | 'drill-lateral'

interface DrillTransition {
  /** Animation class for the canvas wrapper; empty until the first navigation. */
  className: string
  /** Key the wrapper with this so the CSS animation runs exactly once per graph change. */
  key: string
}

// Direction comes from adjusting state during render (the React "adjusting state when
// props change" pattern); keying the wrapper by graph lets the CSS animation play once
// per change and end on its own — no effects, no timers.
export function useDrillTransition(): DrillTransition {
  const graphId = useSessionStore((s) => s.graphId)
  const trailLength = useSessionStore((s) => s.trail.length)
  const [prev, setPrev] = useState({ graphId, trailLength })
  const [direction, setDirection] = useState<DrillDirection | ''>('')

  if (prev.graphId !== graphId) {
    setPrev({ graphId, trailLength })
    setDirection(
      trailLength > prev.trailLength
        ? 'drill-in'
        : trailLength < prev.trailLength
          ? 'drill-out'
          : 'drill-lateral',
    )
  }

  return { className: direction, key: graphId ?? 'none' }
}
