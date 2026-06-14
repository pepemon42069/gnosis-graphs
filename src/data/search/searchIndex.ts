import MiniSearch from 'minisearch'
import { getDb } from '../db'
import type { CommandEvent } from '../events'
import type { FileRecord, GraphRecord, NodeRecord } from '../types'

interface SearchDoc {
  id: string
  type: 'node' | 'graph'
  title: string
  tags: string
  summary: string
  text: string
}

export interface SearchHit {
  id: string
  type: 'node' | 'graph'
  title: string
  score: number
}

const index = new MiniSearch<SearchDoc>({
  fields: ['title', 'tags', 'summary', 'text'],
  storeFields: ['type', 'title'],
  searchOptions: { prefix: true, fuzzy: 0.2, boost: { title: 3, summary: 2 } },
})

/** A node's indexed body: a file's content, a link's url, or nothing. */
function nodeText(node: NodeRecord, fileFor: (id: string) => FileRecord | undefined): string {
  if (node.payload?.kind === 'file') return fileFor(node.payload.fileId)?.content ?? ''
  if (node.payload?.kind === 'link') return node.payload.url
  return ''
}

function nodeDoc(node: NodeRecord, fileFor: (id: string) => FileRecord | undefined): SearchDoc {
  return {
    id: node.id,
    type: 'node',
    title: node.title,
    tags: node.tags.join(' '),
    summary: node.summary ?? '',
    text: nodeText(node, fileFor),
  }
}

function graphDoc(graph: GraphRecord): SearchDoc {
  return { id: graph.id, type: 'graph', title: graph.name, tags: '', summary: '', text: '' }
}

function upsert(docs: SearchDoc[], removedIds: string[]): void {
  for (const id of removedIds) if (index.has(id)) index.discard(id)
  for (const doc of docs) {
    if (index.has(doc.id)) index.discard(doc.id)
    index.add(doc)
  }
}

/** Full rebuild from the database — app load and workspace replace (§7, §9). */
export async function buildSearchIndex(): Promise<void> {
  const db = getDb()
  const [nodes, files, graphs] = await Promise.all([
    db.nodes.toArray(),
    db.files.toArray(),
    db.graphs.toArray(),
  ])
  const byId = new Map(files.map((f) => [f.id, f]))
  const fileFor = (id: string) => byId.get(id)
  index.removeAll()
  index.addAll([...nodes.map((n) => nodeDoc(n, fileFor)), ...graphs.map(graphDoc)])
}

/** Re-index the given nodes, reading each one's current file content. */
async function reindexNodes(ids: string[], removed: string[] = []): Promise<void> {
  const db = getDb()
  const rows = (await db.nodes.bulkGet(ids)).filter((r): r is NodeRecord => r !== undefined)
  const fileIds = rows.flatMap((n) => (n.payload?.kind === 'file' ? [n.payload.fileId] : []))
  const files = (await db.files.bulkGet(fileIds)).filter((f): f is FileRecord => f !== undefined)
  const byId = new Map(files.map((f) => [f.id, f]))
  upsert(
    rows.map((n) => nodeDoc(n, (id) => byId.get(id))),
    removed,
  )
}

/** Incremental maintenance from dispatcher events (§8); wired to onCommand elsewhere. */
export function applyCommandEvent(event: CommandEvent): void {
  for (const e of event.events) {
    if (e.type === 'nodes-changed') {
      void reindexNodes(e.upserted, e.removed)
    } else if (e.type === 'files-changed') {
      // A content edit changes the body of the file's owner node — reindex it.
      void getDb()
        .files.bulkGet(e.fileIds)
        .then((files) => {
          const nodeIds = files.flatMap((f) => (f ? [f.nodeId] : []))
          if (nodeIds.length) void reindexNodes(nodeIds)
        })
    } else if (e.type === 'graphs-changed') {
      void getDb()
        .graphs.bulkGet(e.upserted)
        .then((rows) => upsert(rows.filter((r) => r !== undefined).map(graphDoc), e.removed))
    } else if (e.type === 'workspace-replaced') {
      void buildSearchIndex()
    }
  }
}

export function searchWorkspace(query: string): SearchHit[] {
  if (!query.trim()) return []
  return index.search(query).map((result) => ({
    id: result.id as string,
    type: result.type as SearchHit['type'],
    title: result.title as string,
    score: result.score,
  }))
}
