import { slug } from '../files/slug'
import type { FileRecord, NodeRecord, PlacementRecord, WorkspaceBundle } from '../types'

/** JSON Canvas requires width/height; placements store none, so export fixed defaults (§9). */
export const CANVAS_NODE_WIDTH = 260
export const CANVAS_NODE_HEIGHT = 120

interface CanvasNodeBase {
  id: string
  x: number
  y: number
  width: number
  height: number
}

type CanvasNode =
  | (CanvasNodeBase & { type: 'text'; text: string })
  | (CanvasNodeBase & { type: 'link'; url: string })
  | (CanvasNodeBase & { type: 'file'; file: string })

/**
 * Maps one graph to a JSON Canvas 1.0 document (§9). Lossy by design: kinds,
 * tags, payload-format distinctions, cross-graph node identity, relation-type
 * identity, and child-graph linkage do not round-trip.
 */
export function graphToCanvas(
  bundle: WorkspaceBundle,
  graphId: string,
  fileNameFor: (graphId: string) => string,
): string {
  const nodesById = new Map(bundle.nodes.map((n) => [n.id, n]))
  const filesById = new Map(bundle.files.map((f) => [f.id, f]))
  const graphNames = new Map(bundle.graphs.map((g) => [g.id, g.name]))
  const relationNames = new Map(bundle.relationTypes.map((t) => [t.id, t.name]))

  const nodes = bundle.placements
    .filter((p) => p.graphId === graphId)
    .flatMap((p) => {
      const node = nodesById.get(p.nodeId)
      return node ? [toCanvasNode(node, p, fileNameFor, graphNames, filesById)] : []
    })

  const edges = bundle.edges
    .filter((e) => e.graphId === graphId)
    .map((e) => ({
      id: e.id,
      fromNode: e.fromNodeId,
      toNode: e.toNodeId,
      toEnd: 'arrow' as const,
      label: relationNames.get(e.relationTypeId) ?? '',
    }))

  return JSON.stringify({ nodes, edges }, null, 2)
}

function toCanvasNode(
  node: NodeRecord,
  placement: PlacementRecord,
  fileNameFor: (graphId: string) => string,
  graphNames: Map<string, string>,
  filesById: Map<string, FileRecord>,
): CanvasNode {
  const base = {
    id: node.id,
    x: placement.x,
    y: placement.y,
    width: CANVAS_NODE_WIDTH,
    height: CANVAS_NODE_HEIGHT,
  }
  if (node.payload?.kind === 'link') return { ...base, type: 'link', url: node.payload.url }
  const file = node.payload?.kind === 'file' ? filesById.get(node.payload.fileId) : undefined
  const content = file?.content ?? ''
  const hasContent = content.trim() !== ''
  if (!hasContent && node.childGraphId) {
    return { ...base, type: 'file', file: fileNameFor(node.childGraphId) }
  }
  let text = `# ${node.title}`
  if (hasContent) {
    text +=
      file?.format === 'code'
        ? `\n\n\`\`\`${file.language ?? ''}\n${content}\n\`\`\``
        : `\n\n${content}`
  }
  if (node.childGraphId) {
    const childName = graphNames.get(node.childGraphId) ?? node.childGraphId
    text += `\n\n[${childName}](${fileNameFor(node.childGraphId)})`
  }
  return { ...base, type: 'text', text }
}

/** Stable per-graph filename: slug + short id, so re-exports stay diffable (§9). */
export function slugFileName(name: string, id: string): string {
  return `${slug(name, 'graph')}-${id.slice(0, 8)}.canvas`
}
