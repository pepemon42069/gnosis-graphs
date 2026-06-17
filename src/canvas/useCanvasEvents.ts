import {
  useReactFlow,
  type Connection,
  type EdgeMouseHandler,
  type NodeMouseHandler,
  type OnConnectEnd,
} from '@xyflow/react'
import { useCallback, type MouseEvent as ReactMouseEvent } from 'react'
import { useSessionStore } from '../app/store'
import { fetchGraphData, runCommand } from '../data/client'
import { useContentStore } from '../data/react/contentStore'
import { visitDoc } from '../nav/history'
import { useNavigation } from '../nav/useNavigation'
import type { CardNode, RelationEdgeType } from './flowMapping'

export interface CanvasEvents {
  onPaneContextMenu(event: ReactMouseEvent | MouseEvent): void
  onNodeDoubleClick: NodeMouseHandler<CardNode>
  onNodeContextMenu: NodeMouseHandler<CardNode>
  onEdgeContextMenu: EdgeMouseHandler<RelationEdgeType>
  onConnect(connection: Connection): void
  onConnectEnd: OnConnectEnd
}

/** Removes a node from the current graph (its placement only — the node and any
 *  other placements survive); clears the selection like the keyboard delete. */
async function removeFromCanvas(graphId: string, nodeId: string): Promise<void> {
  const { placements } = await fetchGraphData(graphId)
  const placementIds = placements.filter((p) => p.nodeId === nodeId).map((p) => p.id)
  if (placementIds.length) await runCommand('remove-from-canvas', { placementIds, edgeIds: [] })
  useSessionStore.getState().clearSelection()
}

function confirmDeleteNode(nodeId: string, title: string): void {
  useSessionStore.getState().requestConfirm({
    message: `Delete "${title}" from every graph? Its payload will be lost.`,
    confirmLabel: 'Delete everywhere',
    isDanger: true,
    onConfirm: () => {
      void runCommand('delete-node-everywhere', { nodeId })
      useSessionStore.getState().clearSelection()
    },
  })
}

/** The §5 event table: right-click menus and the two-stage edge gesture. */
export function useCanvasEvents(): CanvasEvents {
  const { screenToFlowPosition } = useReactFlow()
  const { drillIn } = useNavigation()

  // Right-click empty canvas → the node-creation affordance through a menu (§5).
  const onPaneContextMenu = useCallback(
    (e: ReactMouseEvent | MouseEvent) => {
      e.preventDefault()
      const { clientX, clientY } = e
      useSessionStore.getState().openContextMenu({
        x: clientX,
        y: clientY,
        items: [
          {
            label: 'Add node…',
            action: () =>
              useSessionStore.getState().openPicker({
                mode: 'node',
                at: screenToFlowPosition({ x: clientX, y: clientY }),
                forEdge: false,
              }),
          },
        ],
      })
    },
    [screenToFlowPosition],
  )

  // Single click only selects (React Flow's select changes drive that); the
  // content panel is a deliberate double-click, so dragging a node never pops the
  // view open over the canvas and steals room.
  const onNodeDoubleClick = useCallback<NodeMouseHandler<CardNode>>((_e, node) => {
    useSessionStore.getState().openPanel(node.id)
  }, [])

  // Right-click a node → its controls: editor, sub-graph, canvas removal, delete.
  const onNodeContextMenu = useCallback<NodeMouseHandler<CardNode>>(
    (e, node) => {
      e.preventDefault()
      const { clientX, clientY } = e
      const store = useSessionStore.getState()
      const graphId = store.graphId
      const record = useContentStore.getState().nodes.get(node.id)
      const title = record?.title || 'Untitled'
      store.openContextMenu({
        x: clientX,
        y: clientY,
        items: [
          { label: 'Open in editor', action: () => visitDoc(node.id) },
          {
            label: record?.childGraphId ? 'Open sub-graph' : 'Add sub-graph',
            action: () => drillIn(node.id),
          },
          ...(graphId
            ? [{ label: 'Remove from canvas', action: () => void removeFromCanvas(graphId, node.id) }]
            : []),
          { label: 'Delete everywhere', danger: true, action: () => confirmDeleteNode(node.id, title) },
        ],
      })
    },
    [drillIn],
  )

  // Right-click a relationship → menu to retype, reverse or delete it (delete is
  // one undo step, so no confirm — Ctrl+Z restores it).
  const onEdgeContextMenu = useCallback<EdgeMouseHandler<RelationEdgeType>>((e, edge) => {
    e.preventDefault()
    const { clientX, clientY } = e
    useSessionStore.getState().openContextMenu({
      x: clientX,
      y: clientY,
      items: [
        {
          label: 'Reverse direction',
          action: () => void runCommand('reverse-edge', { edgeId: edge.id }),
        },
        {
          label: 'Change relationship type…',
          action: () =>
            useSessionStore.getState().openPicker({
              mode: 'relationType',
              target: { type: 'edge', edgeId: edge.id },
            }),
        },
        {
          label: 'Delete relationship',
          danger: true,
          action: () => void runCommand('delete-edges', { edgeIds: [edge.id] }),
        },
      ],
    })
  }, [])

  const onConnect = useCallback((connection: Connection) => {
    const store = useSessionStore.getState()
    store.beginEdge(connection.source)
    store.completeEdgeTarget(connection.target)
    store.openPicker({ mode: 'relationType', target: { type: 'pending' } })
  }, [])

  // Drops that don't land on a handle: node body → stage two directly;
  // empty canvas → node picker first (§5). React Flow only reports toNode
  // within connectionRadius of a handle, so node bodies need a DOM hit-test.
  const onConnectEnd = useCallback<OnConnectEnd>(
    (event, connectionState) => {
      if (connectionState.isValid) return
      const fromNodeId = connectionState.fromNode?.id
      if (!fromNodeId) return
      const store = useSessionStore.getState()
      const { clientX, clientY } =
        'changedTouches' in event ? (event.changedTouches[0] ?? { clientX: 0, clientY: 0 }) : event
      const toNodeId =
        connectionState.toNode?.id ??
        document
          .elementsFromPoint(clientX, clientY)
          .map((el) => el.closest('.react-flow__node')?.getAttribute('data-id'))
          .find((id) => id != null)
      if (toNodeId) {
        if (toNodeId === fromNodeId) return
        store.beginEdge(fromNodeId)
        store.completeEdgeTarget(toNodeId)
        store.openPicker({ mode: 'relationType', target: { type: 'pending' } })
        return
      }
      store.beginEdge(fromNodeId)
      store.openPicker({
        mode: 'node',
        at: screenToFlowPosition({ x: clientX, y: clientY }),
        forEdge: true,
      })
    },
    [screenToFlowPosition],
  )

  return {
    onPaneContextMenu,
    onNodeDoubleClick,
    onNodeContextMenu,
    onEdgeContextMenu,
    onConnect,
    onConnectEnd,
  }
}
