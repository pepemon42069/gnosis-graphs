import { useReactFlow } from '@xyflow/react'
import { FilterButton } from '../canvas/FilterButton'
import { TidyButton } from '../canvas/TidyButton'
import { downloadCanvasExport } from '../data/interop/canvasExport'
import { Breadcrumbs } from '../nav/Breadcrumbs'
import { visitGraphSource } from '../nav/history'
import { Icon } from '../ui/Icon'
import { useSessionStore } from './store'
import './topBar.css'

const isMac = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac')

/**
 * The one main bar over the content area (the sidenav sits beside, not under
 * it): breadcrumbs left, search centered, canvas icon actions right.
 */
export function TopBar() {
  const { fitView } = useReactFlow()
  const openPicker = useSessionStore((s) => s.openPicker)
  const graphId = useSessionStore((s) => s.graphId)
  const docNodeId = useSessionStore((s) => s.docNodeId)
  const docsOpen = useSessionStore((s) => s.docsOpen)
  const sourceMode = useSessionStore((s) => s.sourceMode)

  const exportCanvas = () => {
    if (!graphId) return
    downloadCanvasExport(graphId).catch((err: unknown) =>
      window.alert(err instanceof Error ? err.message : String(err)),
    )
  }

  return (
    <div className="top-bar">
      <Breadcrumbs />
      <div className="top-bar-right">
        <button
          type="button"
          className="ui-button ui-button--ghost top-bar-icon top-bar-search"
          aria-label="Search"
          title={`Search (${isMac ? '⌘K' : 'Ctrl+K'})`}
          onClick={() => openPicker({ mode: 'command' })}
        >
          <Icon name="search" size={16} />
        </button>
        {!docNodeId && !docsOpen && !sourceMode && (
          <>
            <span className="top-bar-sep" aria-hidden="true">
              |
            </span>
            <div className="top-bar-actions">
              <button
                type="button"
                className="ui-button ui-button--ghost top-bar-icon"
                aria-label="Fit view"
                title="Fit view"
                onClick={() => void fitView({ padding: 0.15, duration: 200 })}
              >
                <Icon name="home" size={16} />
              </button>
              <TidyButton />
              <FilterButton />
              <button
                type="button"
                className="ui-button ui-button--ghost top-bar-icon"
                aria-label="Edit as source"
                title="Edit this graph as source"
                onClick={() => graphId && visitGraphSource(graphId)}
              >
                <Icon name="edit" size={16} />
              </button>
              <button
                type="button"
                className="ui-button ui-button--ghost top-bar-icon"
                aria-label="Export graph"
                title="Export this graph as JSON Canvas"
                onClick={exportCanvas}
              >
                <Icon name="external-link" size={16} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
