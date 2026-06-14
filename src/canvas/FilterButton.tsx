import { useReactFlow } from '@xyflow/react'
import { useMemo, useState } from 'react'
import { useSessionStore } from '../app/store'
import { useGraphData } from '../data/client'
import { useContentStore } from '../data/react/contentStore'
import { Icon } from '../ui/Icon'
import './toolbarMenu.css'

export function FilterButton() {
  const graphId = useSessionStore((s) => s.graphId)
  return graphId ? <FilterAction graphId={graphId} /> : null
}

/** Sorted unique tags across the current graph's placed nodes. */
function useGraphTags(graphId: string): string[] {
  const { placements } = useGraphData(graphId)
  const nodes = useContentStore((s) => s.nodes)
  return useMemo(() => {
    const set = new Set<string>()
    for (const p of placements) for (const t of nodes.get(p.nodeId)?.tags ?? []) set.add(t)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [placements, nodes])
}

function FilterAction({ graphId }: { graphId: string }) {
  const tags = useGraphTags(graphId)
  const tagFilter = useSessionStore((s) => s.tagFilter)
  const toggleTagFilter = useSessionStore((s) => s.toggleTagFilter)
  const clearTagFilter = useSessionStore((s) => s.clearTagFilter)
  const { fitView } = useReactFlow()
  const [open, setOpen] = useState(false)
  const active = tagFilter.length > 0

  // After the visible set changes, frame it — filtered matches are often off-screen.
  const refit = () => setTimeout(() => void fitView({ padding: 0.15, duration: 300 }), 80)
  const toggle = (tag: string) => {
    toggleTagFilter(tag)
    refit()
  }
  const clear = () => {
    clearTagFilter()
    refit()
  }

  return (
    <div className="toolbar-menu-anchor">
      <button
        type="button"
        className={`ui-button ui-button--ghost top-bar-icon${active ? ' top-bar-icon--active' : ''}`}
        aria-label="Filter by tag"
        title={active ? `Showing ${tagFilter.length} tag${tagFilter.length > 1 ? 's' : ''}` : 'Filter by tag'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="filter" size={16} />
        {active && <span className="top-bar-icon-count">{tagFilter.length}</span>}
      </button>
      {open && (
        <>
          <div className="toolbar-menu-backdrop" onMouseDown={() => setOpen(false)} />
          <div className="toolbar-menu" role="menu">
            <div className="toolbar-menu-header">
              <span>Filter by tag</span>
              <button
                type="button"
                className="toolbar-menu-clear"
                disabled={!active}
                onClick={clear}
              >
                Clear
              </button>
            </div>
            {tags.length === 0 ? (
              <div className="toolbar-menu-empty">No tags in this graph</div>
            ) : (
              <div className="toolbar-menu-scroll">
                {tags.map((tag) => {
                  const on = tagFilter.includes(tag)
                  return (
                    <button
                      key={tag}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={on}
                      className={`toolbar-menu-item${on ? ' toolbar-menu-item--active' : ''}`}
                      onClick={() => toggle(tag)}
                    >
                      <span className="toolbar-menu-grow">{tag}</span>
                      {on && <span className="toolbar-menu-check" aria-hidden="true" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
