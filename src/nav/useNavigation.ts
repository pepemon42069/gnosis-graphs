import { useCallback } from 'react'
import { useSessionStore } from '../app/store'
import { runCommand } from '../data/client'
import { useContentStore } from '../data/react/contentStore'
import { visit } from './history'

interface Navigation {
  drillIn(nodeId: string): void
  drillOut(): void
  jumpTo(graphId: string, opts?: { focusNodeId?: string }): void
}

export function useNavigation(): Navigation {
  const drillIn = useCallback((nodeId: string) => {
    const node = useContentStore.getState().nodes.get(nodeId)
    if (!node) return
    const session = useSessionStore.getState()
    if (node.childGraphId) {
      visit(node.childGraphId, [...session.trail, node.childGraphId])
      return
    }
    // Sub-graphs are cheap but never accidental (§4): same gesture, explicit confirm.
    session.requestConfirm({
      message: `Create sub-graph "${node.title}"?`,
      confirmLabel: 'Create',
      onConfirm: () => {
        void runCommand('create-sub-graph', { nodeId, name: node.title }).then((result) => {
          const childId = result.graphId!
          visit(childId, [...useSessionStore.getState().trail, childId])
        })
      },
    })
  }, [])

  const drillOut = useCallback(() => {
    const { trail, graphId, homeGraphId } = useSessionStore.getState()
    const parent = trail[trail.length - 2]
    if (parent !== undefined) {
      visit(parent, trail.slice(0, -1))
      return
    }
    // No parent in the trail → Home (§4), unless already there.
    if (homeGraphId && graphId !== homeGraphId) visit(homeGraphId, [homeGraphId])
  }, [])

  const jumpTo = useCallback((graphId: string, opts?: { focusNodeId?: string }) => {
    // Lateral jump: the trail resets to just the target graph (§4).
    visit(graphId, [graphId])
    if (opts?.focusNodeId) useSessionStore.getState().setPendingFocusNode(opts.focusNodeId)
  }, [])

  return { drillIn, drillOut, jumpTo }
}
