import { useState } from 'react'
import { InfoTip } from '../app/InfoTip'
import { useSessionStore } from '../app/store'
import { useLooseEnds } from '../data/client'
import type { GraphRecord, NodeRecord } from '../data/types'
import { visitDoc } from '../nav/history'
import { Icon } from '../ui/Icon'
import { toggleInSet } from './setUtil'
import { ensureOnGraph } from './treeNav'
import { GraphRow, type TreeCtl } from './TreeRows'
import { useLooseEndActions } from './useLooseEndActions'

/** The §3 loose-ends rescue, folded into the tree as bottom groups (§WS-4). */
export function LooseGroups({ ctl }: { ctl: TreeCtl }) {
  const homeGraphId = useSessionStore((s) => s.homeGraphId)
  const ends = useLooseEnds()
  if (!homeGraphId) return null
  return (
    <LooseGroupsView
      ctl={ctl}
      homeGraphId={homeGraphId}
      unreferencedGraphs={ends.unreferencedGraphs}
      unplacedNodes={ends.unplacedNodes}
    />
  )
}

function LooseGroupsView({
  ctl,
  homeGraphId,
  unreferencedGraphs,
  unplacedNodes,
}: {
  ctl: TreeCtl
  homeGraphId: string
  unreferencedGraphs: GraphRecord[]
  unplacedNodes: NodeRecord[]
}) {
  const actions = useLooseEndActions(homeGraphId)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())

  const toggleSelected = (id: string) => setSelected((prev) => toggleInSet(prev, id))

  const clearSelected = () => setSelected(new Set())

  // placeNodeOnHome targets the root graph — make sure its CANVAS is on
  // screen to receive the focus (a doc page covering it counts as away).
  const place = (node: NodeRecord) => {
    actions.placeNodeOnHome(node)
    ensureOnGraph(homeGraphId, [homeGraphId])
  }

  return (
    <>
      {unreferencedGraphs.length > 0 && (
        <section className="sidebar-section">
          <h3 className="ui-section-label">
            Unlinked graphs
            <InfoTip text="Graphs no node points at — reachable only from here. Link one into the project root or delete it." />
          </h3>
          <ul className="sidebar-list">
            {unreferencedGraphs.map((graph) => (
              <GraphRow
                key={graph.id}
                graph={graph}
                path={[graph.id]}
                ctl={ctl}
                onLink={() => actions.linkGraphHere(graph)}
              />
            ))}
          </ul>
        </section>
      )}
      {unplacedNodes.length > 0 && (
        <section className="sidebar-section">
          <h3 className="ui-section-label">
            Unplaced nodes
            <InfoTip text="Nodes placed on no graph — rescued here so nothing is silently lost. Place, open, or delete them." />
          </h3>
          <ul className="sidebar-list">
            {unplacedNodes.map((node) => (
              <li key={node.id} className="sidebar-row">
                <input
                  type="checkbox"
                  className="sidebar-check"
                  aria-label={`Select ${node.title}`}
                  checked={selected.has(node.id)}
                  onChange={() => toggleSelected(node.id)}
                />
                <button
                  type="button"
                  className="sidebar-item tree-leaf pixel"
                  onClick={() => visitDoc(node.id)}
                >
                  {node.title}
                </button>
                <button
                  type="button"
                  className="sidebar-row-action"
                  aria-label={`Place ${node.title} at project root`}
                  title="Place at project root"
                  onClick={() => place(node)}
                >
                  <Icon name="home" size={14} />
                </button>
                <button
                  type="button"
                  className="sidebar-row-action sidebar-row-action--danger"
                  aria-label={`Delete ${node.title} everywhere`}
                  title="Delete everywhere"
                  onClick={() => actions.confirmDeleteNode(node)}
                >
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          </ul>
          <div className="sidebar-bulk">
            {selected.size > 0 && (
              <button
                type="button"
                className="sidebar-bulk-action pixel"
                onClick={() => actions.confirmDeleteNodes([...selected], clearSelected)}
              >
                Delete selected ({selected.size})
              </button>
            )}
            <button
              type="button"
              className="sidebar-bulk-action pixel"
              onClick={() =>
                actions.confirmDeleteNodes(
                  unplacedNodes.map((n) => n.id),
                  clearSelected,
                )
              }
            >
              Delete all unplaced
            </button>
          </div>
        </section>
      )}
    </>
  )
}
