import type { GnosisDB } from '../db'
import { edgesByGraph, placementsByGraph } from '../queries'
import type {
  EdgeRecord,
  FileRecord,
  GraphRecord,
  KindRecord,
  NodeRecord,
  RelationTypeRecord,
} from '../types'

const TOKEN_LEN = 8

/** Stable order: createdAt then id, so round-trips diff cleanly. */
function byCreatedThenId<T extends { createdAt: number; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

function token(id: string): string {
  return id.slice(0, TOKEN_LEN)
}

/** Serialize one graph to the canonical DSL text. */
export async function serializeGraphSource(db: GnosisDB, graphId: string): Promise<string> {
  const [placements, edges, kinds, relationTypes] = await Promise.all([
    placementsByGraph(graphId),
    edgesByGraph(graphId),
    db.kinds.toArray(),
    db.relationTypes.toArray(),
  ])
  const orderedPlacements = byCreatedThenId(placements)
  const nodeIds = orderedPlacements.map((p) => p.nodeId)
  const nodes = (await db.nodes.bulkGet(nodeIds)).filter((n): n is NodeRecord => n !== undefined)
  const fileIds = nodes.flatMap((n) => (n.payload?.kind === 'file' ? [n.payload.fileId] : []))
  const files = (await db.files.bulkGet(fileIds)).filter((f): f is FileRecord => f !== undefined)
  const graphs = await db.graphs.bulkGet(
    nodes.flatMap((n) => (n.childGraphId ? [n.childGraphId] : [])),
  )

  const fileById = new Map(files.map((f) => [f.id, f]))
  const graphById = new Map(
    graphs.filter((g): g is GraphRecord => g !== undefined).map((g) => [g.id, g]),
  )
  const kindById = new Map(kinds.map((k) => [k.id, k]))
  const relById = new Map(relationTypes.map((r) => [r.id, r]))

  const blocks = nodes.map((node) => serializeNode(node, fileById, graphById, kindById))
  const edgeLines = byCreatedThenId(edges).map((edge) => serializeEdge(edge, relById))
  const sections = [...blocks]
  if (edgeLines.length) sections.push(edgeLines.join('\n'))
  return sections.join('\n\n') + '\n'
}

function serializeNode(
  node: NodeRecord,
  fileById: Map<string, FileRecord>,
  graphById: Map<string, GraphRecord>,
  kindById: Map<string, KindRecord>,
): string {
  const lines = [`#${token(node.id)} ${node.title}`]
  const kind = node.kindId ? kindById.get(node.kindId) : undefined
  if (kind) lines.push(`  kind: ${kind.name}`)
  if (node.tags.length) lines.push(`  tags: ${node.tags.join(', ')}`)
  if (node.summary) lines.push(`  summary: ${node.summary}`)
  if (node.payload?.kind === 'file') {
    const file = fileById.get(node.payload.fileId)
    if (file) lines.push(`  file: ${file.filename}`)
  } else if (node.payload?.kind === 'link') {
    lines.push(`  link: ${node.payload.url}`)
  }
  if (node.childGraphId) {
    const child = graphById.get(node.childGraphId)
    if (child) lines.push(`  // opens: ${child.name}`)
  }
  return lines.join('\n')
}

function serializeEdge(edge: EdgeRecord, relById: Map<string, RelationTypeRecord>): string {
  const rel = relById.get(edge.relationTypeId)?.name ?? 'relates to'
  return `#${token(edge.fromNodeId)} -> #${token(edge.toNodeId)} : ${rel}`
}
