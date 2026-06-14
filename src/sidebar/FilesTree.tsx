import { useState } from 'react'
import { useSessionStore } from '../app/store'
import { runCommand, useFiles, useLooseEnds } from '../data/client'
import type { NodeRecord } from '../data/types'
import { visit, visitDoc } from '../nav/history'
import { Icon } from '../ui/Icon'
import { GraphTreeShell } from './GraphTreeShell'
import { toggleInSet } from './setUtil'
import { ensureOnGraph, freeSpotOnGraph } from './treeNav'
import { type LeafKind, type LeafProps } from './TreeRows'

/** A node carries a file payload (so it has something to view in the Files tree). */
const hasFile = (node: NodeRecord) => node.payload?.kind === 'file'

/**
 * Hierarchical graphs → subgraphs → FILE leaves. Mirrors GraphTree but the only
 * leaves are file-bearing nodes; file-less and link nodes are skipped (this is a
 * file viewer). Unplaced file-bearing nodes get their own bottom group.
 */
export function FilesTree() {
  return (
    <GraphTreeShell leaf={FILE_LEAF}>
      <UnplacedFiles />
    </GraphTreeShell>
  )
}

const FILE_LEAF: LeafKind = { Component: FileLeaf, show: hasFile }

function FileLeaf({ node, graphId, path }: LeafProps) {
  const docNodeId = useSessionStore((s) => s.docNodeId)
  const files = useFiles()
  const filename = files.find((f) => f.nodeId === node.id)?.filename ?? node.title
  const open = () => {
    ensureOnGraph(graphId, path)
    visitDoc(node.id)
  }
  return (
    <li className="sidebar-row">
      <button
        type="button"
        className={`sidebar-item tree-leaf pixel${node.id === docNodeId ? ' sidebar-item--active' : ''}`}
        title={node.title}
        onClick={open}
      >
        <Icon name="file" size={14} className="sidebar-leaf-icon" />
        {filename}
      </button>
    </li>
  )
}

/** "+ New file": create a node-with-file on the active graph, then open it. */
async function createFile() {
  const { graphId, homeGraphId, trail } = useSessionStore.getState()
  const target = graphId ?? homeGraphId
  if (!target) return
  const pos = await freeSpotOnGraph(target)
  const node = await runCommand('create-node', {
    title: 'untitled',
    file: { filename: 'untitled.md', format: 'markdown', content: '' },
    placement: { graphId: target, x: pos.x, y: pos.y },
  })
  // Make sure the file's graph is on screen before opening its doc page.
  if (graphId !== target) visit(target, trail.length ? trail : [target])
  visitDoc(node.nodeId!)
}

function UnplacedFiles() {
  const ends = useLooseEnds()
  const docNodeId = useSessionStore((s) => s.docNodeId)
  const requestConfirm = useSessionStore((s) => s.requestConfirm)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const files = ends.unplacedNodes.filter(hasFile)

  if (files.length === 0) return null

  const toggle = (id: string) => setSelected((prev) => toggleInSet(prev, id))

  const deleteIds = (nodeIds: string[], message: string) => {
    requestConfirm({
      message,
      confirmLabel: 'Delete everywhere',
      isDanger: true,
      onConfirm: () => {
        void runCommand('delete-nodes-everywhere', { nodeIds })
        setSelected(new Set())
      },
    })
  }

  return (
    <section className="sidebar-section">
      <h3 className="ui-section-label">Unplaced files</h3>
      <ul className="sidebar-list">
        {files.map((node) => (
          <li key={node.id} className="sidebar-row">
            <input
              type="checkbox"
              className="sidebar-check"
              aria-label={`Select ${node.title}`}
              checked={selected.has(node.id)}
              onChange={() => toggle(node.id)}
            />
            <button
              type="button"
              className={`sidebar-item tree-leaf pixel${node.id === docNodeId ? ' sidebar-item--active' : ''}`}
              onClick={() => visitDoc(node.id)}
            >
              <Icon name="file" size={14} className="sidebar-leaf-icon" />
              {node.title}
            </button>
          </li>
        ))}
      </ul>
      <div className="sidebar-bulk">
        {selected.size > 0 && (
          <button
            type="button"
            className="sidebar-bulk-action pixel"
            onClick={() =>
              deleteIds(
                [...selected],
                `Delete ${selected.size} selected file${selected.size === 1 ? '' : 's'} from every graph? Their content is permanently lost.`,
              )
            }
          >
            Delete selected ({selected.size})
          </button>
        )}
        <button
          type="button"
          className="sidebar-bulk-action pixel"
          onClick={() =>
            deleteIds(
              files.map((n) => n.id),
              `Delete all ${files.length} unplaced file${files.length === 1 ? '' : 's'} from every graph? Their content is permanently lost.`,
            )
          }
        >
          Delete all unplaced
        </button>
      </div>
    </section>
  )
}

/** Header action exported so the Files pane header can mount it. */
export function NewFileButton() {
  return (
    <button
      type="button"
      className="sidebar-pane-action pixel"
      aria-label="New file on the current graph"
      title="New file on the current graph"
      onClick={() => void createFile()}
    >
      <Icon name="plus" size={14} />
      New file
    </button>
  )
}
