import { useCallback, useSyncExternalStore } from 'react'
import type { CommandEvent, StoreEvent } from './events'
import { useContentStore } from './react/contentStore'
import type { AppearsIn, LooseEnds } from './queries'
import type { EdgeRecord, FileRecord, GraphRecord, PlacementRecord, WorkspaceBundle } from './types'

/**
 * The single client data seam: HTTP for reads/commands, SSE for reactivity.
 * Replaces Dexie + liveQuery + the in-process dispatcher. Same-origin in
 * production (the server serves the SPA); Vite proxies /api in dev.
 */

const API = '/api'

async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(API + path)
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`)
  return r.json() as Promise<T>
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  if (!r.ok) {
    const detail = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(detail.error ?? `POST ${path} -> ${r.status}`)
  }
  return r.json() as Promise<T>
}

// ---- Commands -------------------------------------------------------------

export type CommandResult = Record<string, string>

export function runCommand(kind: string, args: Record<string, unknown> = {}): Promise<CommandResult> {
  return apiPost<{ result: CommandResult }>('/command', { kind, args }).then((r) => r.result)
}

export const runUndo = () => apiPost('/undo')
export const runRedo = () => apiPost('/redo')
export const ensureVocab = (table: 'kind' | 'relationType', name: string) =>
  apiPost<{ id: string }>(`/ensure/${table}`, { name }).then((r) => r.id)

// ---- One-shot fetches -----------------------------------------------------

export const fetchMeta = () =>
  apiGet<{ homeGraphId: string | null; rootGraphId: string | null; initialGraphId: string | null }>(
    '/meta',
  )
const fetchUsage = (table: 'kind' | 'relation-type', id: string) =>
  apiGet<{ count: number }>(`/usage/${table}/${id}`).then((r) => r.count)
export const searchWorkspace = (q: string) =>
  apiGet<{ id: string; type: 'node' | 'graph'; title: string; score: number }[]>(
    `/search?q=${encodeURIComponent(q)}`,
  )
export const fetchExport = () => apiGet<WorkspaceBundle>('/export')
export const importBundle = (bundle: unknown) => apiPost('/import', bundle)
/** Reset to a clean empty workspace (server snapshots first; throws on !ok). */
export const resetWorkspace = () => apiPost('/reset')
const fetchFile = (id: string) => apiGet<FileRecord>(`/file/${id}`)

/** Sidebar file-explorer listing — identity + filename, no content. */
export type FileSummary = Pick<FileRecord, 'id' | 'nodeId' | 'filename' | 'format' | 'language'>
const fetchFiles = () => apiGet<FileSummary[]>('/files')

export interface SourceSummary {
  creates: number
  updates: number
  edgeAdds: number
  edgeRemoves: number
  placementsRemoved: number
  nodesDeleted: number
}
export interface SourceError {
  line: number
  message: string
}

export const fetchGraphSource = (id: string) =>
  apiGet<{ source: string }>(`/graph/${id}/source`).then((r) => r.source)

/** Parse errors come back as a 400 body, not a thrown error — callers branch on
 *  `ok` to surface line-numbered messages in the editor. */
export async function applyGraphSource(
  id: string,
  source: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ ok: boolean; summary?: SourceSummary; errors?: SourceError[]; error?: string }> {
  const r = await fetch(`${API}/graph/${id}/source`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source, dryRun: opts.dryRun ?? false }),
  })
  return r.json() as Promise<{
    ok: boolean
    summary?: SourceSummary
    errors?: SourceError[]
    error?: string
  }>
}
export const fetchAppearsIn = (nodeId: string) => apiGet<AppearsIn>(`/node/${nodeId}/appears-in`)
export const fetchGraphData = (graphId: string) =>
  apiGet<{ placements: PlacementRecord[]; edges: EdgeRecord[] }>(`/graph/${graphId}`)

// ---- Query cache ----------------------------------------------------------

const cache = new Map<string, unknown>()
const fetchers = new Map<string, () => Promise<unknown>>()
const subs = new Map<string, Set<() => void>>()

async function load(key: string): Promise<void> {
  const f = fetchers.get(key)
  if (!f) return
  try {
    cache.set(key, await f())
    subs.get(key)?.forEach((cb) => cb())
  } catch {
    // transient; an SSE event or remount retries
  }
}

function invalidate(key: string): void {
  // A key with live subscribers is re-fetched; a cache-only entry (nobody is
  // watching) is dropped so the next subscribe fetches fresh — never round-trip
  // for a record that may have just been deleted (a deleted file would 404).
  if (subs.get(key)?.size) void load(key)
  else cache.delete(key)
}

function invalidatePrefix(prefix: string): void {
  for (const key of new Set([...cache.keys(), ...subs.keys()])) {
    if (key.startsWith(prefix)) invalidate(key)
  }
}

/** Subscribe to a keyed server query; re-fetches when SSE invalidates the key. */
function useApiQuery<T>(key: string | null, fetcher: () => Promise<T>, fallback: T): T {
  // The fetcher is (re)registered every render. This must stay in the render body,
  // not move into the subscribe effect or get eagerly deleted on unsubscribe: an
  // SSE invalidate can fire load(key) while a key is momentarily unsubscribed mid
  // remount (e.g. drill-in), and the registered fetcher must already be present or
  // the live query silently stops updating. The fetcher is equivalent for a fixed
  // key (the key encodes its inputs), so re-registering it is idempotent. The map
  // is bounded by the set of distinct keys, not per-render.
  if (key) fetchers.set(key, fetcher as () => Promise<unknown>)
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!key) return () => {}
      const set = subs.get(key) ?? new Set<() => void>()
      subs.set(key, set)
      set.add(cb)
      if (!cache.has(key)) void load(key)
      return () => set.delete(cb)
    },
    [key],
  )
  const snapshot = useSyncExternalStore(
    subscribe,
    () => (key && cache.has(key) ? (cache.get(key) as T) : fallback),
    () => fallback,
  )
  return snapshot
}

const EMPTY_GRAPH = { placements: [] as PlacementRecord[], edges: [] as EdgeRecord[] }

export function useGraphData(graphId: string | null): {
  placements: PlacementRecord[]
  edges: EdgeRecord[]
} {
  return useApiQuery(graphId ? `graph:${graphId}` : null, () => fetchGraphData(graphId!), EMPTY_GRAPH)
}

export function useFile(fileId: string | null): FileRecord | null {
  return useApiQuery<FileRecord | null>(
    fileId ? `file:${fileId}` : null,
    () => fetchFile(fileId!),
    null,
  )
}

const EMPTY_APPEARS: AppearsIn = { graphs: [], parentNodes: [] }
export function useAppearsIn(nodeId: string | null): AppearsIn {
  return useApiQuery(nodeId ? `appears:${nodeId}` : null, () => fetchAppearsIn(nodeId!), EMPTY_APPEARS)
}

const EMPTY_LOOSE: LooseEnds = { unreferencedGraphs: [], unplacedNodes: [] }
export function useLooseEnds(): LooseEnds {
  return useApiQuery('loose-ends', () => apiGet<LooseEnds>('/loose-ends'), EMPTY_LOOSE)
}

/** Placement count of a graph (node-card child badge); reuses the graph query. */
export function useGraphCount(graphId: string | null): number {
  return useGraphData(graphId).placements.length
}

export function useUsage(table: 'kind' | 'relation-type', id: string): number {
  return useApiQuery(`usage:${table}:${id}`, () => fetchUsage(table, id), 0)
}

const EMPTY_FILES: FileSummary[] = []
/** All workspace files for the sidebar explorer; refreshed on any files-changed. */
export function useFiles(): FileSummary[] {
  return useApiQuery('files', fetchFiles, EMPTY_FILES)
}

// ---- Vocab + graphs (content store) --------------------------------------

interface Vocab {
  nodes: import('./types').NodeRecord[]
  kinds: import('./types').KindRecord[]
  relationTypes: import('./types').RelationTypeRecord[]
  graphs: GraphRecord[]
}

export async function refreshVocab(): Promise<void> {
  const v = await apiGet<Vocab>('/vocab')
  const s = useContentStore.getState()
  s.setNodes(v.nodes)
  s.setKinds(v.kinds)
  s.setRelationTypes(v.relationTypes)
  s.setGraphs(v.graphs)
}

// ---- SSE reactivity -------------------------------------------------------

function applyEvents(events: StoreEvent[]): void {
  for (const ev of events) {
    switch (ev.type) {
      case 'placements-changed':
        ev.graphIds.forEach((g) => invalidate(`graph:${g}`))
        invalidate('loose-ends')
        invalidatePrefix('appears:')
        break
      case 'edges-changed':
        ev.graphIds.forEach((g) => invalidate(`graph:${g}`))
        invalidatePrefix('appears:')
        invalidatePrefix('usage:')
        break
      case 'nodes-changed':
        void refreshVocab()
        invalidatePrefix('appears:')
        invalidatePrefix('usage:')
        invalidate('loose-ends')
        break
      case 'files-changed':
        ev.fileIds.forEach((id) => invalidate(`file:${id}`))
        invalidate('files')
        break
      case 'graphs-changed':
        void refreshVocab()
        invalidatePrefix('appears:')
        invalidate('loose-ends')
        break
      case 'vocab-changed':
        void refreshVocab()
        invalidatePrefix('usage:')
        break
      case 'workspace-replaced':
        void refreshVocab()
        invalidatePrefix('graph:')
        invalidatePrefix('appears:')
        invalidate('loose-ends')
        invalidate('files')
        break
    }
  }
}

/** Open the SSE stream. Reconnect is automatic (EventSource). Idempotent. */
let connected = false
export function connectEvents(): void {
  if (connected) return
  connected = true
  const es = new EventSource(API + '/events')
  es.onmessage = (e) => {
    if (!e.data) return
    const event = JSON.parse(e.data) as CommandEvent
    applyEvents(event.events)
  }
}
