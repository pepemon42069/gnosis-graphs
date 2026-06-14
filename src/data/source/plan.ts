import type { GnosisDB } from '../db'
import { edgesByGraph, placementsByGraph, placementsOfNode } from '../queries'
import type { FileRecord, KindRecord, NodeRecord, RelationTypeRecord } from '../types'
import type { ParsedGraph, ParsedNode } from './parse'

interface PayloadRef {
  file?: string
  link?: string
}

interface NodeCreate {
  /** The local alias (token) this node was declared under, if any. */
  alias?: string
  parsed: ParsedNode
}

export interface NodeUpdate {
  nodeId: string
  parsed: ParsedNode
  /** Meta diffs (title/summary/kind/tags) — undefined fields are unchanged. */
  meta: { title?: string; summary?: string; kindName?: string | null; tags?: string[] }
  /** Payload-ref change vs current, or undefined when the reference is unchanged. */
  payload?: { current: PayloadRef; desired: PayloadRef }
}

interface EdgeAdd {
  from: string
  to: string
  relation: string
  line: number
}

interface NodeRemoval {
  nodeId: string
  placementId: string
  /** This graph's edges touching the node. */
  edgeIds: string[]
  /** True ⇒ the node is placed in no other graph; delete it everywhere. */
  deleteGlobal: boolean
}

interface PlanSummary {
  creates: number
  updates: number
  edgeAdds: number
  edgeRemoves: number
  placementsRemoved: number
  nodesDeleted: number
}

export interface Plan {
  nodesToCreate: NodeCreate[]
  nodesToUpdate: NodeUpdate[]
  edgesToAdd: EdgeAdd[]
  edgesToRemove: string[]
  vocabToEnsure: { kinds: string[]; relations: string[] }
  nodesRemoved: NodeRemoval[]
  /** alias/token → resolved existing nodeId (the prefix matches). */
  resolved: Map<string, string>
  summary: PlanSummary
}

/** Read-only diff of the desired source against the graph's current state. */
export async function planGraphSource(
  db: GnosisDB,
  graphId: string,
  parsed: ParsedGraph,
): Promise<Plan> {
  const [placements, edges, kinds, relationTypes] = await Promise.all([
    placementsByGraph(graphId),
    edgesByGraph(graphId),
    db.kinds.toArray(),
    db.relationTypes.toArray(),
  ])
  const placedNodes = (await db.nodes.bulkGet(placements.map((p) => p.nodeId))).filter(
    (n): n is NodeRecord => n !== undefined,
  )
  const placementByNode = new Map(placements.map((p) => [p.nodeId, p]))
  const placedFileIds = placedNodes.flatMap((n) =>
    n.payload?.kind === 'file' ? [n.payload.fileId] : [],
  )
  const fileById = new Map(
    (await db.files.bulkGet(placedFileIds))
      .filter((f): f is FileRecord => f !== undefined)
      .map((f) => [f.id, f]),
  )

  const resolved = new Map<string, string>()
  const seenNodeIds = new Set<string>()
  const nodesToCreate: NodeCreate[] = []
  const nodesToUpdate: NodeUpdate[] = []

  for (const node of parsed.nodes) {
    const existingId = node.token
      ? resolveToken(node.token, placedNodes, node.line)
      : undefined
    if (existingId) {
      resolved.set(node.token!, existingId)
      seenNodeIds.add(existingId)
      const record = placedNodes.find((n) => n.id === existingId)!
      const update = diffNode(record, node, kinds, fileById)
      if (update) nodesToUpdate.push(update)
    } else {
      if (node.token) resolved.set(node.token, '')
      nodesToCreate.push({ alias: node.token, parsed: node })
    }
  }

  // Match desired vs current edges on (from,to,relation), resolving tokens to
  // node ids. Edges touching a new-alias endpoint (unresolved) are always adds.
  const relName = new Map(relationTypes.map((r) => [r.id, r.name.toLowerCase()]))
  const key = (from: string, to: string, rel: string) => `${from}|${to}|${rel.toLowerCase()}`
  const wantKeys = new Set<string>()
  const wantEdgeAdds: EdgeAdd[] = []
  const existingEdgeKeys = new Set(
    edges.map((e) => key(e.fromNodeId, e.toNodeId, relName.get(e.relationTypeId) ?? '')),
  )
  for (const edge of parsed.edges) {
    const fromId = resolved.get(edge.from)
    const toId = resolved.get(edge.to)
    const k = fromId && toId ? key(fromId, toId, edge.relation) : null
    if (k) wantKeys.add(k)
    if (!k || !existingEdgeKeys.has(k)) {
      wantEdgeAdds.push({ from: edge.from, to: edge.to, relation: edge.relation, line: edge.line })
    }
  }
  const edgesToRemove = edges
    .filter((e) => !wantKeys.has(key(e.fromNodeId, e.toNodeId, relName.get(e.relationTypeId) ?? '')))
    .map((e) => e.id)

  const vocabToEnsure = collectVocab(parsed, kinds, relationTypes)

  // Full-sync removals: a placed node the source omitted is removed from this
  // canvas, taking this graph's touching edges; if it lands unplaced everywhere,
  // it is deleted globally (node + files).
  const nodesRemoved: NodeRemoval[] = []
  for (const node of placedNodes) {
    if (seenNodeIds.has(node.id)) continue
    const placement = placementByNode.get(node.id)
    if (!placement) continue
    const touching = edges
      .filter((e) => e.fromNodeId === node.id || e.toNodeId === node.id)
      .map((e) => e.id)
    const otherPlacements = (await placementsOfNode(node.id)).filter((p) => p.graphId !== graphId)
    nodesRemoved.push({
      nodeId: node.id,
      placementId: placement.id,
      edgeIds: touching,
      deleteGlobal: otherPlacements.length === 0,
    })
  }

  // Each removed edge has exactly one owner: deleteEdges handles standalone
  // removals, removeFromCanvas (via NodeRemoval.edgeIds) owns edges touching a
  // removed node. Subtract the latter so no edge id is ever addressed twice.
  const removedNodeEdgeIds = new Set(nodesRemoved.flatMap((r) => r.edgeIds))
  const standaloneEdgeRemovals = edgesToRemove.filter((id) => !removedNodeEdgeIds.has(id))

  const summary: PlanSummary = {
    creates: nodesToCreate.length,
    updates: nodesToUpdate.length,
    edgeAdds: wantEdgeAdds.length,
    edgeRemoves: standaloneEdgeRemovals.length + removedNodeEdgeIds.size,
    placementsRemoved: nodesRemoved.length,
    nodesDeleted: nodesRemoved.filter((r) => r.deleteGlobal).length,
  }

  return {
    nodesToCreate,
    nodesToUpdate,
    edgesToAdd: wantEdgeAdds,
    edgesToRemove: standaloneEdgeRemovals,
    vocabToEnsure,
    nodesRemoved,
    resolved,
    summary,
  }
}

function resolveToken(token: string, placed: NodeRecord[], line: number): string | undefined {
  const matches = placed.filter((n) => n.id.startsWith(token))
  if (matches.length > 1) {
    throw new Error(`line ${line}: ambiguous anchor #${token} (matches ${matches.length} nodes)`)
  }
  return matches[0]?.id
}

function diffNode(
  record: NodeRecord,
  parsed: ParsedNode,
  kinds: KindRecord[],
  fileById: Map<string, FileRecord>,
): NodeUpdate | null {
  const meta: NodeUpdate['meta'] = {}
  if (parsed.title && parsed.title !== record.title) meta.title = parsed.title
  const summary = parsed.summary ?? ''
  if (summary !== (record.summary ?? '')) meta.summary = summary
  const currentKind = record.kindId ? kinds.find((k) => k.id === record.kindId)?.name : undefined
  if (parsed.kind === undefined) {
    if (record.kindId) meta.kindName = null
  } else if ((currentKind ?? '').toLowerCase() !== parsed.kind.toLowerCase()) {
    meta.kindName = parsed.kind
  }
  if (!sameTags(record.tags, parsed.tags)) meta.tags = parsed.tags

  const current = currentRef(record, fileById)
  const desired: PayloadRef = { file: parsed.file, link: parsed.link }
  // Only a *specified* file/link is a change. Omitting both leaves the payload
  // untouched (clearing a reference is a panel action, not a source edit) — so the
  // plan must not report a phantom update the apply would silently no-op.
  const payloadChanged =
    (desired.file !== undefined && desired.file !== current.file) ||
    (desired.link !== undefined && desired.link !== current.link)
  const metaChanged = Object.keys(meta).length > 0
  if (!metaChanged && !payloadChanged) return null
  return {
    nodeId: record.id,
    parsed,
    meta,
    ...(payloadChanged ? { payload: { current, desired } } : {}),
  }
}

function currentRef(record: NodeRecord, fileById: Map<string, FileRecord>): PayloadRef {
  if (record.payload?.kind === 'file') {
    return { file: fileById.get(record.payload.fileId)?.filename }
  }
  if (record.payload?.kind === 'link') return { link: record.payload.url }
  return {}
}

function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((t, i) => t === b[i])
}

function collectVocab(
  parsed: ParsedGraph,
  kinds: KindRecord[],
  rels: RelationTypeRecord[],
): { kinds: string[]; relations: string[] } {
  const kindNames = new Set(kinds.map((k) => k.name.toLowerCase()))
  const relNames = new Set(rels.map((r) => r.name.toLowerCase()))
  const missingKinds = new Map<string, string>()
  const missingRels = new Map<string, string>()
  for (const node of parsed.nodes) {
    if (node.kind && !kindNames.has(node.kind.toLowerCase())) {
      missingKinds.set(node.kind.toLowerCase(), node.kind)
    }
  }
  for (const edge of parsed.edges) {
    if (!relNames.has(edge.relation.toLowerCase())) {
      missingRels.set(edge.relation.toLowerCase(), edge.relation)
    }
  }
  return { kinds: [...missingKinds.values()], relations: [...missingRels.values()] }
}
