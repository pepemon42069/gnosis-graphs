import { useSessionStore } from '../app/store'
import { fetchAppearsIn } from '../data/client'
import { useContentStore } from '../data/react/contentStore'

export interface NavState {
  graphId: string
  trail: string[]
  /** Document page open over this graph context (§WS-3). */
  docNodeId?: string
  /** DSL source editor open over this graph (Phase 2). */
  sourceMode?: boolean
  /** In-app documentation viewer open over this graph context. */
  docsOpen?: boolean
}

/** Cold load on a `#/d/<nodeId>` hash with no usable history.state. */
export interface DocOnlyNav {
  docNodeId: string
}

/** Cold load on a `#/docs` hash with no usable history.state (no graph context). */
export interface DocsOnlyNav {
  docsOpen: true
}

/**
 * The single navigation funnel (§4): every graph visit goes through here, and
 * this module owns every pushState/replaceState call. history.state carries
 * {graphId, trail, docNodeId?} so the browser's own back/forward/reload restore
 * all three; the hash makes a cold load land on the right graph or document.
 */
export function visit(graphId: string, trail: string[], mode: 'push' | 'replace' = 'push'): void {
  useSessionStore.getState().setGraph(graphId, trail)
  write({ graphId, trail }, `#/g/${graphId}`, mode)
}

function write(state: NavState, url: string, mode: 'push' | 'replace'): void {
  if (mode === 'push') history.pushState(state, '', url)
  else history.replaceState(state, '', url)
}

/** Opens the document page over the current graph context. */
export function visitDoc(nodeId: string, mode: 'push' | 'replace' = 'push'): void {
  const { graphId, trail } = useSessionStore.getState()
  if (!graphId) return
  useSessionStore.getState().setDoc(nodeId)
  write({ graphId, trail, docNodeId: nodeId }, `#/d/${nodeId}`, mode)
}

/**
 * Deterministic close (Escape/back button in the page chrome) for any full-page
 * overlay — doc page, source editor, or docs viewer: replace-visit the underlying
 * graph, which clears all three overlay flags together. history.back() is never
 * used — the History API can't tell whether a previous entry exists or is ours.
 */
export function closeOverlay(): void {
  const { graphId, trail } = useSessionStore.getState()
  if (graphId) visit(graphId, trail, 'replace')
}

/** Opens the DSL source editor over the current graph context. */
export function visitGraphSource(graphId: string, mode: 'push' | 'replace' = 'push'): void {
  const { trail } = useSessionStore.getState()
  useSessionStore.getState().setSourceMode(true)
  write({ graphId, trail, sourceMode: true }, `#/g/${graphId}/source`, mode)
}

/** Opens the in-app documentation viewer over the current graph context. */
export function visitDocs(mode: 'push' | 'replace' = 'push'): void {
  const { graphId, trail } = useSessionStore.getState()
  if (!graphId) return
  useSessionStore.getState().setDocsOpen(true)
  write({ graphId, trail, docsOpen: true }, '#/docs', mode)
}

export function parseNavState(value: unknown): NavState | null {
  if (typeof value !== 'object' || value === null) return null
  const { graphId, trail, docNodeId, sourceMode, docsOpen } = value as Partial<NavState>
  if (typeof graphId !== 'string') return null
  if (!Array.isArray(trail) || !trail.every((t) => typeof t === 'string')) return null
  if (docNodeId !== undefined && typeof docNodeId !== 'string') return null
  if (sourceMode !== undefined && typeof sourceMode !== 'boolean') return null
  if (docsOpen !== undefined && typeof docsOpen !== 'boolean') return null
  return {
    graphId,
    trail,
    ...(docNodeId === undefined ? {} : { docNodeId }),
    ...(sourceMode ? { sourceMode } : {}),
    ...(docsOpen ? { docsOpen } : {}),
  }
}

/** Pure hash parser: `#/g/<id>`, `#/g/<id>/source`, `#/d/<nodeId>`, or `#/docs`. */
export function parseHash(hash: string): NavState | DocOnlyNav | DocsOnlyNav | null {
  if (hash === '#/docs') return { docsOpen: true }
  const source = /^#\/g\/([^/]+)\/source$/.exec(hash)
  if (source?.[1]) return { graphId: source[1], trail: [source[1]], sourceMode: true }
  const graph = /^#\/g\/(.+)$/.exec(hash)
  if (graph?.[1]) return { graphId: graph[1], trail: [graph[1]] }
  const doc = /^#\/d\/(.+)$/.exec(hash)
  if (doc?.[1]) return { docNodeId: doc[1] }
  return null
}

/** Boot-time navigation source: history.state, then the hash, then nothing. */
function readNavState(): NavState | DocOnlyNav | DocsOnlyNav | null {
  const fromState = parseNavState(history.state)
  if (fromState) return fromState
  return parseHash(window.location.hash)
}

/**
 * Reload-safe boot: restore the saved position when it still exists. A doc
 * route renders even for an unplaced node — the page only needs the node
 * record; the graph context comes from the saved state, else a placement,
 * else the fallback (Home).
 */
export async function restoreNavigation(fallbackGraphId: string): Promise<void> {
  // refreshVocab() has populated the content store before this runs (boot order).
  const content = useContentStore.getState()
  const nav = readNavState()
  const savedGraph = nav && 'graphId' in nav && content.graphs.has(nav.graphId) ? nav : null
  const docNodeId = nav && 'docNodeId' in nav ? nav.docNodeId : undefined
  const docNode = docNodeId ? content.nodes.get(docNodeId) : undefined

  if (docNode) {
    let graphId: string
    let trail: string[]
    if (savedGraph) {
      ;({ graphId, trail } = savedGraph)
    } else {
      const appears = await fetchAppearsIn(docNode.id)
      graphId = appears.graphs[0]?.graph.id ?? fallbackGraphId
      trail = [graphId]
    }
    visit(graphId, trail, 'replace')
    visitDoc(docNode.id, 'replace')
    return
  }
  if (savedGraph) {
    visit(savedGraph.graphId, savedGraph.trail, 'replace')
    if (savedGraph.sourceMode) visitGraphSource(savedGraph.graphId, 'replace')
    else if (savedGraph.docsOpen) visitDocs('replace')
    return
  }
  // Cold load on `#/docs` (no graph context): open docs over the fallback graph.
  if (nav && 'docsOpen' in nav && nav.docsOpen) {
    visit(fallbackGraphId, [fallbackGraphId], 'replace')
    visitDocs('replace')
    return
  }
  visit(fallbackGraphId, [fallbackGraphId], 'replace')
}
