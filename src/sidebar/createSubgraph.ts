import { useSessionStore } from '../app/store'
import { runCommand } from '../data/client'
import { visit } from '../nav/history'
import { freeSpotOnGraph } from './treeNav'

/**
 * Tree right-click "New graph/subgraph": a child graph plus a pointer node on
 * the parent, then enter it. Three commands → three undo steps (the
 * linkGraphHere tradeoff).
 */
export function createSubgraph(parentGraphId: string, parentPath: string[]): void {
  useSessionStore.getState().requestPrompt({
    message: 'New graph name',
    placeholder: 'Untitled graph',
    submitLabel: 'Create',
    onSubmit: (name) => {
      void (async () => {
        const graph = await runCommand('create-graph', { name })
        const pos = await freeSpotOnGraph(parentGraphId)
        const node = await runCommand('create-node', {
          title: name,
          placement: { graphId: parentGraphId, x: pos.x, y: pos.y },
        })
        await runCommand('link-child-graph', { nodeId: node.nodeId!, graphId: graph.graphId! })
        visit(graph.graphId!, [...parentPath, graph.graphId!])
      })()
    },
  })
}
