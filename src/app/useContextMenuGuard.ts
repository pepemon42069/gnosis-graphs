import { useEffect } from 'react'
import { isTextTarget } from '../keyboard/isTextTarget'

/** Suppress the browser's default context menu app-wide so right-click feels
 *  native to the app — the canvas and sidebar provide their own menus, and
 *  elsewhere there is nothing to fall back to. Text-editing surfaces (inputs,
 *  textareas, the CodeMirror editor) keep the native menu for copy/paste. */
export function useContextMenuGuard(): void {
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      if (isTextTarget(e.target)) return
      e.preventDefault()
    }
    document.addEventListener('contextmenu', onContextMenu)
    return () => document.removeEventListener('contextmenu', onContextMenu)
  }, [])
}
