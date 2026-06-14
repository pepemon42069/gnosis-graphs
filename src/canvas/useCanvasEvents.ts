import {
  useReactFlow,
  type Connection,
  type EdgeMouseHandler,
  type NodeMouseHandler,
  type OnConnectEnd,
} from '@xyflow/react'
import { useCallback, type MouseEvent as ReactMouseEvent } from 'react'
import { useSessionStore } from '../app/store'
import { runCommand } from '../data/client'
import { useNavigation } from '../nav/useNavigation'
import type { CardNode, RelationEdgeType } from './flowMapping'

export interface CanvasEvents {
  onPaneClick(event: ReactMouseEvent): void
  onPaneContextMenu(event: ReactMouseEvent | MouseEvent): void
  onNodeClick: NodeMouseHandler<CardNode>
  onNodeDoubleClick: NodeMouseHandler<CardNode>
  onEdgeDoubleClick: EdgeMouseHandler<RelationEdgeType>
  onEdgeContextMenu: EdgeMouseHandler<RelationEdgeType>
  onConnect(connection: Connection): void
  onConnectEnd: OnConnectEnd
}

/** The §5 event table: double-clicks and the two-stage edge gesture. */
export function useCanvasEvents(): CanvasEvents {
  const { screenToFlowPosition } = useReactFlow()
  const { drillIn } = useNavigation()

  const onPaneClick = useCallback(
    (e: ReactMouseEvent) => {
      if (e.detail !== 2) return
      useSessionStore.getState().openPicker({
        mode: 'node',
        at: screenToFlowPosition({ x: e.clientX, y: e.clientY }),
        forEdge: false,
      })
    },
    [screenToFlowPosition],
  )

  // Right-click mirrors the double-click affordance through a menu (§5).
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

  // §5 "Click: select; open side panel" — selection flows through RF's select
  // changes, but re-clicking an already-selected node emits none, so the panel
  // reopen needs the explicit click.
  const onNodeClick = useCallback<NodeMouseHandler<CardNode>>((_e, node) => {
    useSessionStore.getState().openPanel(node.id)
  }, [])

  const onNodeDoubleClick = useCallback<NodeMouseHandler<CardNode>>(
    (_e, node) => drillIn(node.id),
    [drillIn],
  )

  const onEdgeDoubleClick = useCallback<EdgeMouseHandler<RelationEdgeType>>((_e, edge) => {
    useSessionStore.getState().openPicker({
      mode: 'relationType',
      target: { type: 'edge', edgeId: edge.id },
    })
  }, [])

  // Right-click a relationship → menu to retype or delete it (delete is one
  // undo step, so no confirm — Ctrl+Z restores it).
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
    onPaneClick,
    onPaneContextMenu,
    onNodeClick,
    onNodeDoubleClick,
    onEdgeDoubleClick,
    onEdgeContextMenu,
    onConnect,
    onConnectEnd,
  }
}
