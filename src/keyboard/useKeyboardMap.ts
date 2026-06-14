import { useReactFlow } from '@xyflow/react'
import { useEffect } from 'react'
import { useSessionStore } from '../app/store'
import { fetchGraphData, runCommand, runRedo, runUndo } from '../data/client'
import { closeOverlay } from '../nav/history'
import { useNavigation } from '../nav/useNavigation'
import { isTextTarget } from './isTextTarget'

/**
 * §5 focus scoping for Enter/Delete/Shift+1: only when focus rests on the
 * canvas (body after a pane/card click, or inside React Flow) and never on a
 * focused control — Enter must activate a focused button, not drill in.
 */
function isCanvasScope(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target === document.body) return true
  if (target.closest('button, input, textarea, select, [contenteditable], .cm-editor')) return false
  return target.closest('.react-flow') !== null
}

/**
 * The §5 keyboard map. One window listener, bubble phase: pickers, dialogs and
 * CodeMirror own their keys locally with stopPropagation/preventDefault, so DOM
 * propagation itself is the innermost-first dismissal order. Enter, Delete and
 * Shift+1 are canvas-scoped (text-target gated); Escape and Mod shortcuts are
 * global. Browser history shortcuts are never intercepted — no bindings exist.
 */
export function useKeyboardMap(): void {
  const { fitView } = useReactFlow()
  const { drillIn, drillOut } = useNavigation()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const store = useSessionStore.getState()

      if (mod && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        store.openPicker({ mode: 'command' })
        return
      }
      // Mod+Z applies to the focused surface (§6): CodeMirror consumes it
      // (defaultPrevented), text inputs keep native undo, else structural.
      if (mod && e.key.toLowerCase() === 'z') {
        if (e.defaultPrevented || isTextTarget(e.target)) return
        e.preventDefault()
        void (e.shiftKey ? runRedo() : runUndo())
        return
      }
      if (mod && e.shiftKey && e.code === 'Period') {
        e.preventDefault()
        // No drilling from under a full-page view — no canvas on screen.
        if (store.docNodeId || store.sourceMode || store.docsOpen) return
        const nodeId = singleSelectedNode()
        if (nodeId) drillIn(nodeId)
        return
      }
      if (mod && e.shiftKey && e.code === 'Comma') {
        e.preventDefault()
        // "Go up" from a full-page overlay means closing it back to its graph.
        if (store.docNodeId || store.sourceMode || store.docsOpen) {
          closeOverlay()
          return
        }
        drillOut()
        return
      }
      if (e.key === 'Escape') {
        // CodeMirror consumes Escape for simplifySelection (defaultPrevented),
        // and innermost-first means that press goes no further.
        if (e.defaultPrevented) return
        // Full-page overlays sit between settings and panel in the dismissal
        // ladder; closing them is a navigation, so it lives here not in escape().
        if (!store.settingsOpen && (store.docNodeId || store.sourceMode || store.docsOpen)) {
          closeOverlay()
          return
        }
        store.escape()
        return
      }
      if (!isCanvasScope(e.target)) return

      if (e.key === 'Enter') {
        const nodeId = singleSelectedNode()
        if (nodeId) {
          e.preventDefault()
          drillIn(nodeId)
        }
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const { selection, graphId } = store
        if (!graphId || (!selection.nodeIds.length && !selection.edgeIds.length)) return
        e.preventDefault()
        void deleteSelection(graphId, selection.nodeIds, selection.edgeIds)
        return
      }
      if (e.shiftKey && e.code === 'Digit1') {
        e.preventDefault()
        void fitView({ padding: 0.15, duration: 200 })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fitView, drillIn, drillOut])
}

function singleSelectedNode(): string | null {
  const { selection } = useSessionStore.getState()
  return selection.nodeIds.length === 1 ? (selection.nodeIds[0] ?? null) : null
}

async function deleteSelection(
  graphId: string,
  nodeIds: string[],
  edgeIds: string[],
): Promise<void> {
  const placements = (await fetchGraphData(graphId)).placements.filter((p) =>
    nodeIds.includes(p.nodeId),
  )
  await runCommand('remove-from-canvas', { placementIds: placements.map((p) => p.id), edgeIds })
  useSessionStore.getState().clearSelection()
}
