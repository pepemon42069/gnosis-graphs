import { useEffect } from 'react'
import { useSessionStore } from '../app/store'
import { useContentStore } from '../data/react/contentStore'
import { parseNavState, visit } from './history'

/**
 * popstate only ever reads — restoring {graphId, trail, docNodeId?} into the
 * store without pushing. An entry whose graph (or doc node) has since been
 * deleted is repaired with a replace-visit, so the dead entry doesn't linger
 * as a back target. Staleness is checked two ways after each await: a sequence
 * counter orders popstates, and re-parsing history.state catches programmatic
 * visit()s that moved the entry while the DB reads ran.
 */
export function useHistorySync(): void {
  useEffect(() => {
    const onPopState = (e: PopStateEvent) => {
      const nav = parseNavState(e.state)
      if (!nav) return
      // Content store reads are synchronous now — no await race, no seq guard.
      const content = useContentStore.getState()
      const graph = content.graphs.get(nav.graphId)
      const docNode = nav.docNodeId ? content.nodes.get(nav.docNodeId) : undefined
      if (graph) {
        if (nav.docNodeId && !docNode) {
          // Doc node gone: rewrite the entry to the bare graph route.
          visit(nav.graphId, nav.trail, 'replace')
          return
        }
        const store = useSessionStore.getState()
        store.setGraph(nav.graphId, nav.trail)
        if (docNode) store.setDoc(docNode.id)
        else if (nav.sourceMode) store.setSourceMode(true)
        else if (nav.docsOpen) store.setDocsOpen(true)
        return
      }
      const home = useSessionStore.getState().homeGraphId
      if (home) visit(home, [home], 'replace')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
}
