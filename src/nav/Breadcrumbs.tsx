import { Fragment } from 'react'
import { useSessionStore } from '../app/store'
import { useContentStore } from '../data/react/contentStore'
import { visit } from './history'
import './nav.css'

const COLLAPSE_BEYOND = 6
const TAIL_SEGMENTS = 4

type Segment = { kind: 'graph'; index: number } | { kind: 'ellipsis' }

function visibleSegments(length: number): Segment[] {
  if (length <= COLLAPSE_BEYOND) {
    return Array.from({ length }, (_, index): Segment => ({ kind: 'graph', index }))
  }
  return [
    { kind: 'graph', index: 0 },
    { kind: 'ellipsis' },
    ...Array.from(
      { length: TAIL_SEGMENTS },
      (_, i): Segment => ({ kind: 'graph', index: length - TAIL_SEGMENTS + i }),
    ),
  ]
}

export function Breadcrumbs() {
  const trail = useSessionStore((s) => s.trail)
  const docNodeId = useSessionStore((s) => s.docNodeId)
  const graphMap = useContentStore((s) => s.graphs)
  const graphs = trail.map((id) => graphMap.get(id))
  const docTitle = useContentStore((s) =>
    docNodeId ? (s.nodes.get(docNodeId)?.title ?? '…') : null,
  )

  const goTo = (index: number) => {
    const graphId = trail[index]
    if (graphId !== undefined) visit(graphId, trail.slice(0, index + 1))
  }

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {visibleSegments(trail.length).map((segment, position) => (
        <Fragment key={segment.kind === 'graph' ? segment.index : 'ellipsis'}>
          {position > 0 && <span className="breadcrumbs-sep">›</span>}
          {segment.kind === 'ellipsis' ? (
            <span className="breadcrumbs-ellipsis">…</span>
          ) : segment.index === trail.length - 1 && docTitle === null ? (
            <span className="breadcrumbs-current" aria-current="page">
              {graphs?.[segment.index]?.name ?? '…'}
            </span>
          ) : (
            <button type="button" className="breadcrumbs-link" onClick={() => goTo(segment.index)}>
              {graphs?.[segment.index]?.name ?? '…'}
            </button>
          )}
        </Fragment>
      ))}
      {docTitle !== null && (
        <>
          <span className="breadcrumbs-sep">›</span>
          <span className="breadcrumbs-current" aria-current="page">
            {docTitle}
          </span>
        </>
      )}
    </nav>
  )
}
