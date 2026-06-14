import { useReactFlow } from '@xyflow/react'
import { useSessionStore } from '../app/store'
import { runCommand, useAppearsIn } from '../data/client'
import { useNavigation } from '../nav/useNavigation'
import { Icon } from '../ui/Icon'

function PlaceInCurrentGraph({ nodeId }: { nodeId: string }) {
  const graphId = useSessionStore((s) => s.graphId)
  const { screenToFlowPosition } = useReactFlow()
  if (!graphId) return null
  const place = () => {
    const center = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    })
    void runCommand('add-placement', { graphId, nodeId, x: center.x, y: center.y })
  }
  return (
    <button type="button" className="ui-button pixel panel-place-button" onClick={place}>
      Place in current graph
    </button>
  )
}

export function AppearsIn({ nodeId }: { nodeId: string }) {
  const appears = useAppearsIn(nodeId)
  const { jumpTo } = useNavigation()
  return (
    <section className="panel-appears">
      <span
        className="panel-prop-label"
        title="The same node can be placed on many graphs — one node, one payload; every placement shows the same content"
      >
        Appears in{appears.graphs.length > 0 && ` · ${appears.graphs.length}`}
      </span>
      {appears.graphs.length === 0 ? (
        <>
          <p className="panel-appears-empty">Not placed in any graph</p>
          <PlaceInCurrentGraph nodeId={nodeId} />
        </>
      ) : (
        <ul className="panel-appears-list">
          {appears.graphs.map(({ graph }) => (
            <li key={graph.id}>
              <button
                type="button"
                className="panel-appears-chip pixel"
                title={`Jump to ${graph.name}`}
                onClick={() => jumpTo(graph.id, { focusNodeId: nodeId })}
              >
                <Icon name="chevron-right" size={12} /> {graph.name}
              </button>
            </li>
          ))}
          {appears.parentNodes.map((parent) => (
            <li key={parent.id}>
              <span
                className="panel-appears-chip panel-appears-chip--parent pixel"
                title={`Lives inside the sub-graph of "${parent.title}"`}
              >
                <Icon name="branch" size={12} /> {parent.title}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
