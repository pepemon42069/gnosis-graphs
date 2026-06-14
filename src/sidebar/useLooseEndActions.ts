import { useCallback } from 'react'
import { useSessionStore } from '../app/store'
import { runCommand } from '../data/client'
import type { GraphRecord, NodeRecord } from '../data/types'
import { freeSpotOnGraph } from './treeNav'

export interface LooseEndActions {
  linkGraphHere(graph: GraphRecord): void
  placeNodeOnHome(node: NodeRecord): void
  confirmDeleteNode(node: NodeRecord): void
  confirmDeleteNodes(nodeIds: string[], onDone?: () => void): void
}

export function useLooseEndActions(homeGraphId: string): LooseEndActions {
  const requestConfirm = useSessionStore((s) => s.requestConfirm)
  const setPendingFocusNode = useSessionStore((s) => s.setPendingFocusNode)

  const linkGraphHere = useCallback(
    (graph: GraphRecord) => {
      void (async () => {
        const pos = await freeSpotOnGraph(homeGraphId)
        // Two commands → two undo steps; fine for a rescue gesture.
        const node = await runCommand('create-node', {
          title: graph.name,
          placement: { graphId: homeGraphId, x: pos.x, y: pos.y },
        })
        await runCommand('link-child-graph', { nodeId: node.nodeId!, graphId: graph.id })
      })()
    },
    [homeGraphId],
  )

  const placeNodeOnHome = useCallback(
    (node: NodeRecord) => {
      void (async () => {
        const pos = await freeSpotOnGraph(homeGraphId)
        try {
          await runCommand('add-placement', { graphId: homeGraphId, nodeId: node.id, x: pos.x, y: pos.y })
        } catch (err) {
          // Already placed (cross-tab race): the goal — node placed — is met.
          if (!(err instanceof Error && err.message.includes('already placed'))) throw err
        }
        setPendingFocusNode(node.id)
      })()
    },
    [homeGraphId, setPendingFocusNode],
  )

  const confirmDeleteNode = useCallback(
    (node: NodeRecord) => {
      requestConfirm({
        message: `Delete "${node.title}" from every graph? Its payload will be lost.`,
        confirmLabel: 'Delete everywhere',
        isDanger: true,
        onConfirm: () => void runCommand('delete-node-everywhere', { nodeId: node.id }),
      })
    },
    [requestConfirm],
  )

  const confirmDeleteNodes = useCallback(
    (nodeIds: string[], onDone?: () => void) => {
      if (nodeIds.length === 0) return
      requestConfirm({
        message: `Delete ${nodeIds.length} node${nodeIds.length === 1 ? '' : 's'} from every graph? Their payloads will be lost.`,
        confirmLabel: 'Delete everywhere',
        isDanger: true,
        onConfirm: () => {
          void runCommand('delete-nodes-everywhere', { nodeIds })
          onDone?.()
        },
      })
    },
    [requestConfirm],
  )

  return {
    linkGraphHere,
    placeNodeOnHome,
    confirmDeleteNode,
    confirmDeleteNodes,
  }
}
