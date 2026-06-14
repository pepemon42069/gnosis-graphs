import { lazy, Suspense, useEffect, useState } from 'react'
import { fetchGraphSource } from '../data/client'
import { useContentStore } from '../data/react/contentStore'
import './source.css'

// Lazy: SourceBody pulls the full CodeMirror graph, like the doc bodies. This
// shell (loader + chrome) stays in the main chunk so CodeMirror never does.
const SourceBody = lazy(() => import('./SourceBody'))

/**
 * Full-page DSL source editor for one graph (Phase 2). Loads the serialized
 * source, then hands off to the lazy editor body for the edit + apply flow.
 */
export function GraphSourceEditor({ graphId }: { graphId: string }) {
  const graph = useContentStore((s) => s.graphs.get(graphId))
  const [source, setSource] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    void fetchGraphSource(graphId).then((text) => {
      if (!stale) setSource(text)
    })
    return () => {
      stale = true
    }
  }, [graphId])

  if (source === null) return <div className="source-page" />
  return (
    <Suspense fallback={<div className="source-page" />}>
      <SourceBody key={graphId} graphId={graphId} name={graph?.name ?? 'graph'} source={source} />
    </Suspense>
  )
}
