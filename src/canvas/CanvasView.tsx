import { Background, ConnectionMode, ReactFlow, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSessionStore } from '../app/store'
import type { XY } from '../app/types'
import { useThemePreference } from '../settings/theme'
import { NodeCard } from './node/NodeCard'
import { RelationEdge } from './edge/RelationEdge'
import { useCanvasEvents } from './useCanvasEvents'
import { useFlowGraph } from './useFlowGraph'
import { usePaste } from './usePaste'
import type { RelationEdgeType } from './flowMapping'
import './canvas.css'

const nodeTypes = { card: NodeCard }
const edgeTypes = { relation: RelationEdge }

export function CanvasView({ graphId }: { graphId: string }) {
  // Remount per graph: useFlowGraph's local state is per-graph by contract.
  return <GraphCanvas key={graphId} graphId={graphId} />
}

function GraphCanvas({ graphId }: { graphId: string }) {
  const flow = useFlowGraph(graphId)
  const events = useCanvasEvents()
  // "system" alone would ignore the Settings → Appearance override and strand
  // a dark canvas in a light app (or vice versa).
  const colorMode = useThemePreference()
  const { screenToFlowPosition, setCenter, getZoom, getViewport } = useReactFlow()
  const lastPointer = useRef<XY | null>(null)

  // §4: navigation never auto-fits. Restore this graph's last camera if we have
  // one; only a graph's first visit (no saved viewport) fits to contents. Read
  // once at mount — GraphCanvas remounts per graph, so this is per-graph state.
  const [initialViewport] = useState(() => useSessionStore.getState().graphViewports[graphId])
  useEffect(
    () => () => useSessionStore.getState().setGraphViewport(graphId, getViewport()),
    [graphId, getViewport],
  )

  usePaste(
    useCallback(() => {
      const p = lastPointer.current ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
      return screenToFlowPosition(p)
    }, [screenToFlowPosition]),
  )

  // Consume a requested focus (search jump, picker create) once its placement is known.
  const pendingFocusNodeId = useSessionStore((s) => s.pendingFocusNodeId)
  useEffect(() => {
    if (!pendingFocusNodeId) return
    const placement = flow.placementOf(pendingFocusNodeId)
    if (!placement) return
    void setCenter(placement.x + 130, placement.y + 44, {
      duration: 250,
      zoom: Math.max(getZoom(), 0.8),
    })
    const store = useSessionStore.getState()
    store.setSelection({ nodeIds: [pendingFocusNodeId], edgeIds: [] })
    // A deliberate jump (search/sidebar/loose-end rescue) opens the view, unlike a
    // bare canvas click — setSelection alone no longer does.
    store.openPanel(pendingFocusNodeId)
    store.setPendingFocusNode(null)
  }, [pendingFocusNodeId, flow, setCenter, getZoom])

  // Dashed provisional edge anchors the relation-type picker visually (§5).
  const pendingEdge = useSessionStore((s) => s.pendingEdge)
  const edges = useMemo<RelationEdgeType[]>(() => {
    if (!pendingEdge?.toNodeId) return flow.edges
    return [
      ...flow.edges,
      {
        id: '__pending__',
        source: pendingEdge.fromNodeId,
        target: pendingEdge.toNodeId,
        type: 'relation' as const,
        data: { relationTypeId: '' },
        style: { strokeDasharray: '6 4' },
        selectable: false,
      },
    ]
  }, [flow.edges, pendingEdge])

  return (
    <div
      className="canvas-view"
      onPointerMove={(e) => {
        lastPointer.current = { x: e.clientX, y: e.clientY }
      }}
    >
      <ReactFlow
        nodes={flow.nodes}
        edges={edges}
        onNodesChange={flow.onNodesChange}
        onEdgesChange={flow.onEdgesChange}
        onNodeDragStart={flow.onNodeDragStart}
        onNodeDragStop={flow.onNodeDragStop}
        onPaneContextMenu={events.onPaneContextMenu}
        onMoveEnd={(_, viewport) =>
          useSessionStore.getState().setGraphViewport(graphId, viewport)
        }
        onNodeDoubleClick={events.onNodeDoubleClick}
        onNodeContextMenu={events.onNodeContextMenu}
        onEdgeContextMenu={events.onEdgeContextMenu}
        onConnect={events.onConnect}
        onConnectEnd={events.onConnectEnd}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        colorMode={colorMode}
        onlyRenderVisibleElements
        deleteKeyCode={null}
        // The §5 keyboard map owns Escape/arrow semantics; RF's per-node
        // handlers would unselect before the panel-first dismissal order runs.
        disableKeyboardA11y
        zoomOnDoubleClick={false}
        defaultViewport={initialViewport}
        fitView={!initialViewport}
      >
        <Background />
      </ReactFlow>
      {flow.isEmpty && (
        <div className="canvas-empty-hint">
          Right-click to add a node · right-click a node for more
        </div>
      )}
    </div>
  )
}
