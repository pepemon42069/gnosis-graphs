import type { ReactNode } from 'react'
import { useSessionStore } from '../app/store'
import { useContentStore } from '../data/react/contentStore'
import { GraphRow, type LeafKind, type TreeCtl } from './TreeRows'
import { useTreeExpansion } from './useTreeExpansion'

/**
 * Shared graph-tree scaffold: expansion state, the home-rooted GraphRow, and the
 * scroll container. Trees differ only in their leaf and the bottom section
 * (`children`, given the same expansion `ctl`).
 */
export function GraphTreeShell({
  leaf,
  children,
}: {
  leaf?: LeafKind
  /** Bottom section, given the shared expansion control. */
  children?: ReactNode | ((ctl: TreeCtl) => ReactNode)
}) {
  const homeGraphId = useSessionStore((s) => s.homeGraphId)
  const trail = useSessionStore((s) => s.trail)
  const ctl = useTreeExpansion(trail)
  const home = useContentStore((s) => (homeGraphId ? s.graphs.get(homeGraphId) : undefined))

  if (!home) return null
  return (
    <div className="sidebar-pane-scroll">
      <ul className="sidebar-list">
        <GraphRow graph={home} path={[home.id]} ctl={ctl} isHome leaf={leaf} />
      </ul>
      {typeof children === 'function' ? children(ctl) : children}
    </div>
  )
}
