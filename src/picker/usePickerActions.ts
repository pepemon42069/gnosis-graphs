import { useReactFlow } from '@xyflow/react'
import { useCallback } from 'react'
import { useSessionStore } from '../app/store'
import type { XY } from '../app/types'
import { nudgePosition } from '../canvas/spawnPosition'
import { ensureVocab, fetchGraphData, runCommand } from '../data/client'
import { visitDoc } from '../nav/history'
import { useNavigation } from '../nav/useNavigation'
import { rankedPlacements } from './placementRank'
import type { PickerRow } from './usePickerResults'

type NodePick = Extract<PickerRow, { kind: 'node' | 'createNode' }>

/** Resolves the pick to a node placed in the graph; an already-placed node is left alone. */
async function pickNode(
  row: NodePick,
  graphId: string,
  at: XY | null,
  viewportCenter: () => XY,
): Promise<string> {
  const placements = (await fetchGraphData(graphId)).placements
  if (row.kind === 'node' && placements.some((p) => p.nodeId === row.nodeId)) return row.nodeId
  const pos = nudgePosition(at ?? viewportCenter(), placements)
  if (row.kind === 'createNode') {
    const result = await runCommand('create-node', {
      title: row.query,
      placement: { graphId, x: pos.x, y: pos.y },
    })
    return result.nodeId!
  }
  try {
    await runCommand('add-placement', { graphId, nodeId: row.nodeId, x: pos.x, y: pos.y })
  } catch (err) {
    // Already placed (the pre-check normally avoids this; a cross-tab race): met.
    if (!(err instanceof Error && err.message.includes('already placed'))) throw err
  }
  return row.nodeId
}

export interface PickerActions {
  activate(row: PickerRow): Promise<void>
  cancel(): void
}

export function usePickerActions(): PickerActions {
  const { screenToFlowPosition } = useReactFlow()
  const { jumpTo } = useNavigation()

  const activate = useCallback(
    async (row: PickerRow) => {
      const store = useSessionStore.getState()
      const { picker, graphId } = store
      if (!picker || !graphId) return

      // Mod+K teleport rows (§7).
      if (row.kind === 'graph') {
        store.closePicker({ cancelEdge: false })
        jumpTo(row.graphId)
        return
      }
      if (row.kind === 'nodePlacement') {
        store.closePicker({ cancelEdge: false })
        jumpTo(row.graphId, { focusNodeId: row.nodeId })
        return
      }
      if (row.kind === 'node' && picker.mode === 'command') {
        const best = (await rankedPlacements(row.nodeId, store.recentGraphIds))[0]
        store.closePicker({ cancelEdge: false })
        if (!best) {
          // Zero placements: open the panel; "appears in" offers placing (§7).
          // From the doc page, show its doc instead — a panel over a doc page
          // would mount two seed-only editors for one node, clobbering saves.
          if (store.docNodeId) {
            if (store.docNodeId !== row.nodeId) visitDoc(row.nodeId)
          } else {
            store.openPanel(row.nodeId)
          }
          return
        }
        // From the doc page a bare pendingFocusNode is invisible (no canvas
        // mounted) — jump, which exits the doc and focuses on arrival.
        if (best.placement.graphId === store.graphId && !store.docNodeId) {
          store.setPendingFocusNode(row.nodeId)
        } else {
          jumpTo(best.placement.graphId, { focusNodeId: row.nodeId })
        }
        return
      }

      if (row.kind === 'node' || row.kind === 'createNode') {
        if (picker.mode !== 'node' && picker.mode !== 'command') return
        const viewportCenter = () =>
          screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
        const at = picker.mode === 'node' ? picker.at : null
        const nodeId = await pickNode(row, graphId, at, viewportCenter)
        // Escape can land while pickNode is in flight; the cancel closed the
        // picker and must win — never resurrect the gesture from stale state.
        if (useSessionStore.getState().picker !== picker) return
        if (picker.mode === 'node' && picker.forEdge) {
          store.completeEdgeTarget(nodeId)
          store.openPicker({ mode: 'relationType', target: { type: 'pending' } })
        } else {
          if (store.docNodeId) jumpTo(graphId, { focusNodeId: nodeId })
          else store.setPendingFocusNode(nodeId)
          store.closePicker({ cancelEdge: false })
        }
        return
      }

      if (picker.mode !== 'relationType') return
      const relationTypeId =
        row.kind === 'relationType' ? row.relationTypeId : await ensureVocab('relationType', row.query)
      if (picker.target.type === 'edge') {
        await runCommand('retype-edge', { edgeId: picker.target.edgeId, relationTypeId })
      } else {
        const pending = store.pendingEdge
        if (pending?.toNodeId) {
          await runCommand('create-edge', {
            graphId,
            fromNodeId: pending.fromNodeId,
            toNodeId: pending.toNodeId,
            relationTypeId,
          })
        }
        store.clearPendingEdge()
      }
      store.closePicker({ cancelEdge: false })
    },
    [screenToFlowPosition, jumpTo],
  )

  /**
   * §5 cancel semantics: Escape at the node stage kills the whole edge gesture
   * (nothing dispatched yet); Escape at the relation-type stage discards only
   * the pending edge — a node captured in stage one survives.
   */
  const cancel = useCallback(() => {
    const store = useSessionStore.getState()
    const { picker } = store
    if (!picker) return
    if (picker.mode === 'command') {
      store.closePicker({ cancelEdge: false })
      return
    }
    if (picker.mode === 'node') {
      store.closePicker({ cancelEdge: picker.forEdge })
      return
    }
    if (picker.target.type === 'pending') store.clearPendingEdge()
    store.closePicker({ cancelEdge: false })
  }, [])

  return { activate, cancel }
}
