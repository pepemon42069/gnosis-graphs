import { useRef } from 'react'
import type { PointerEvent } from 'react'
import { useSessionStore } from '../app/store'

export interface PanelResizeHandlers {
  onPointerDown(e: PointerEvent<HTMLElement>): void
  onPointerMove(e: PointerEvent<HTMLElement>): void
  onPointerUp(e: PointerEvent<HTMLElement>): void
  onPointerCancel(e: PointerEvent<HTMLElement>): void
}

/**
 * Drag handlers for the panel's left-edge resize handle. Pointer capture keeps
 * move/up events routed to the handle, so no global listeners are needed.
 * setPanelWidth clamps to 260–720.
 */
export function usePanelResize(): PanelResizeHandlers {
  const activePointerId = useRef<number | null>(null)

  const endDrag = (e: PointerEvent<HTMLElement>) => {
    if (activePointerId.current !== e.pointerId) return
    activePointerId.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  return {
    onPointerDown(e) {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      activePointerId.current = e.pointerId
    },
    onPointerMove(e) {
      if (activePointerId.current !== e.pointerId) return
      useSessionStore.getState().setPanelWidth(window.innerWidth - e.clientX)
    },
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  }
}
