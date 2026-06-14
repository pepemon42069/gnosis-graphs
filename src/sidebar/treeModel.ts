import type { GraphRecord, NodeRecord } from '../data/types'

export interface TreeChildren {
  folders: { graph: GraphRecord }[]
  leaves: NodeRecord[]
}

/**
 * Children of one expanded graph row: subgraph folders (deduped — several
 * nodes may point at one graph) first, then plain-node leaves, both sorted.
 * A node whose childGraphId is missing from graphsById degrades to a leaf.
 */
export function deriveChildren(
  nodes: (NodeRecord | undefined)[],
  graphsById: ReadonlyMap<string, GraphRecord>,
): TreeChildren {
  const folders: TreeChildren['folders'] = []
  const leaves: NodeRecord[] = []
  const seen = new Set<string>()
  for (const node of nodes) {
    if (!node) continue
    const graph = node.childGraphId ? graphsById.get(node.childGraphId) : undefined
    if (graph) {
      if (!seen.has(graph.id)) {
        seen.add(graph.id)
        folders.push({ graph })
      }
    } else {
      leaves.push(node)
    }
  }
  folders.sort((a, b) => a.graph.name.localeCompare(b.graph.name))
  leaves.sort((a, b) => a.title.localeCompare(b.title))
  return { folders, leaves }
}
