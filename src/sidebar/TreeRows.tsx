import { useMemo, type ComponentType, type MouseEvent as ReactMouseEvent } from 'react'
import { useSessionStore } from '../app/store'
import { runCommand, useGraphData } from '../data/client'
import { useContentStore } from '../data/react/contentStore'
import type { GraphRecord, NodeRecord } from '../data/types'
import { visit, visitDoc } from '../nav/history'
import { Icon } from '../ui/Icon'
import { createSubgraph } from './createSubgraph'
import { ensureOnGraph } from './treeNav'
import { deriveChildren } from './treeModel'

export interface TreeCtl {
  expanded: ReadonlySet<string>
  toggle(key: string): void
}

export interface LeafProps {
  node: NodeRecord
  graphId: string
  /** Graph trail down to the node's parent graph. */
  path: string[]
}

/**
 * How a tree renders + decides leaf rows. `Component` renders one leaf;
 * `show` filters which placed nodes become leaves (default: all) so an empty
 * subgraph can collapse to "empty" rather than a hidden row.
 */
export interface LeafKind {
  Component: ComponentType<LeafProps>
  show?(node: NodeRecord): boolean
}

const NODE_LEAF: LeafKind = { Component: NodeLeaf }

interface GraphRowProps {
  graph: GraphRecord
  /** Graph ids from the tree root down to this row — doubles as the visit trail. */
  path: string[]
  ctl: TreeCtl
  isHome?: boolean
  /** Loose-end rescue (§WS-4): renders a "link into project root" action when given. */
  onLink?: () => void
  /** How leaf nodes render — defaults to the node-focus leaf (graph tree). */
  leaf?: LeafKind
}

export function GraphRow({ graph, path, ctl, isHome = false, onLink, leaf = NODE_LEAF }: GraphRowProps) {
  const currentGraphId = useSessionStore((s) => s.graphId)
  const requestConfirm = useSessionStore((s) => s.requestConfirm)
  const key = path.join('/')
  const open = ctl.expanded.has(key)
  // A graph that (transitively) contains itself: show the row, don't recurse.
  const cyclic = path.slice(0, -1).includes(graph.id)

  const show = () => ensureOnGraph(graph.id, path)

  const rename = () => {
    useSessionStore.getState().requestPrompt({
      message: `Rename "${graph.name}"`,
      initialValue: graph.name,
      submitLabel: 'Rename',
      onSubmit: (name) => {
        if (name !== graph.name) void runCommand('rename-graph', { graphId: graph.id, name })
      },
    })
  }

  // Shared nav-repair after a graph delete: if the deleted graph sits on the
  // current trail, cut the dead prefix / fall back to the parent or Home (§3).
  const repairNav = () => {
    const { trail, homeGraphId: home, graphId: current } = useSessionStore.getState()
    const idx = trail.indexOf(graph.id)
    if (idx === -1) return
    if (current === graph.id) {
      const parent = trail[idx - 1]
      const target = parent && useContentStore.getState().graphs.get(parent) ? parent : home
      if (target) visit(target, parent === target ? trail.slice(0, idx) : [target], 'replace')
      return
    }
    if (current) visit(current, trail.slice(idx + 1), 'replace')
  }

  const remove = () => {
    requestConfirm({
      message: `Delete graph "${graph.name}"? Its placements and edges are removed; nodes survive. Nodes pointing at it lose their sub-graph link.`,
      confirmLabel: 'Delete graph',
      isDanger: true,
      onConfirm: () => {
        void (async () => {
          await runCommand('delete-graph', { graphId: graph.id })
          repairNav()
        })()
      },
    })
  }

  const removeDeep = () => {
    requestConfirm({
      message: `Delete graph "${graph.name}" and its files? The graph, its placements, edges, and every node that lives only here (with its file) are permanently removed.`,
      confirmLabel: 'Delete graph and files',
      isDanger: true,
      onConfirm: () => {
        void (async () => {
          await runCommand('delete-graph-deep', { graphId: graph.id })
          repairNav()
        })()
      },
    })
  }

  const onContextMenu = (e: ReactMouseEvent) => {
    e.preventDefault()
    useSessionStore.getState().openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: isHome ? 'New graph…' : 'New subgraph…',
          action: () => createSubgraph(graph.id, path),
        },
      ],
    })
  }

  return (
    <li>
      <div className="sidebar-row" onContextMenu={onContextMenu}>
        <button
          type="button"
          className="tree-disclosure"
          aria-label={`${open ? 'Collapse' : 'Expand'} ${graph.name}`}
          aria-expanded={open}
          disabled={cyclic}
          title={cyclic ? 'Contains itself — open the row above' : undefined}
          onClick={() => ctl.toggle(key)}
        >
          <Icon name={cyclic ? 'reload' : open ? 'chevron-down' : 'chevron-right'} size={12} />
        </button>
        <button
          type="button"
          className={`sidebar-item pixel${isHome ? ' sidebar-item--root' : ''}${
            graph.id === currentGraphId ? ' sidebar-item--active' : ''
          }`}
          onClick={show}
        >
          <Icon
            name={isHome ? 'home' : open && !cyclic ? 'folder-open' : 'folder'}
            size={14}
            className="sidebar-leaf-icon"
          />
          {graph.name}
        </button>
        {onLink && (
          <button
            type="button"
            className="sidebar-row-action"
            aria-label={`Link ${graph.name} into project root`}
            title="Link into project root"
            onClick={onLink}
          >
            <Icon name="link" size={14} />
          </button>
        )}
        {!isHome && (
          <>
            <button
              type="button"
              className="sidebar-row-action"
              aria-label={`Rename graph ${graph.name}`}
              title="Rename"
              onClick={rename}
            >
              <Icon name="edit" size={14} />
            </button>
            <button
              type="button"
              className="sidebar-row-action"
              aria-label={`Delete graph ${graph.name}`}
              title="Delete graph (keep nodes)"
              onClick={remove}
            >
              <Icon name="close" size={14} />
            </button>
            <button
              type="button"
              className="sidebar-row-action sidebar-row-action--danger"
              aria-label={`Delete graph ${graph.name} and its files`}
              title="Delete graph and its files"
              onClick={removeDeep}
            >
              <Icon name="trash" size={14} />
            </button>
          </>
        )}
      </div>
      {open && !cyclic && <GraphChildren graphId={graph.id} path={path} ctl={ctl} leaf={leaf} />}
    </li>
  )
}

function GraphChildren({
  graphId,
  path,
  ctl,
  leaf,
}: {
  graphId: string
  path: string[]
  ctl: TreeCtl
  leaf: LeafKind
}) {
  // Placements drive the row; node/graph records come from the content store —
  // both update via the SSE event stream.
  const { placements } = useGraphData(graphId)
  const nodesMap = useContentStore((s) => s.nodes)
  const graphsMap = useContentStore((s) => s.graphs)
  const children = useMemo(() => {
    const nodes = placements.map((p) => nodesMap.get(p.nodeId))
    const childGraphIds = [...new Set(nodes.flatMap((n) => (n?.childGraphId ? [n.childGraphId] : [])))]
    const graphsById = new Map(
      childGraphIds.flatMap((id) => {
        const g = graphsMap.get(id)
        return g ? [[id, g] as const] : []
      }),
    )
    return deriveChildren(nodes, graphsById)
  }, [placements, nodesMap, graphsMap])

  const Leaf = leaf.Component
  const leaves = leaf.show ? children.leaves.filter(leaf.show) : children.leaves

  if (children.folders.length === 0 && leaves.length === 0) {
    return (
      <ul className="sidebar-list sidebar-list--nested">
        <li className="tree-empty">empty</li>
      </ul>
    )
  }
  return (
    <ul className="sidebar-list sidebar-list--nested">
      {children.folders.map(({ graph }) => (
        <GraphRow key={graph.id} graph={graph} path={[...path, graph.id]} ctl={ctl} leaf={leaf} />
      ))}
      {leaves.map((node) => (
        <Leaf key={node.id} node={node} graphId={graphId} path={path} />
      ))}
    </ul>
  )
}

function NodeLeaf({ node, graphId, path }: LeafProps) {
  const focus = () => {
    ensureOnGraph(graphId, path)
    useSessionStore.getState().setPendingFocusNode(node.id)
  }
  return (
    <li className="sidebar-row">
      <button type="button" className="sidebar-item tree-leaf pixel" onClick={focus}>
        {node.title}
      </button>
      <button
        type="button"
        className="sidebar-row-action"
        aria-label={`Open ${node.title} in editor`}
        title="Open in editor"
        onClick={() => {
          // The doc context is the node's graph, not whatever is on screen.
          ensureOnGraph(graphId, path)
          visitDoc(node.id)
        }}
      >
        <Icon name="edit" size={14} />
      </button>
    </li>
  )
}
