import { Handle, Position, type NodeProps } from '@xyflow/react'
import { memo } from 'react'
import { useGraphCount } from '../../data/client'
import { useContentStore } from '../../data/react/contentStore'
import { Icon } from '../../ui/Icon'
import type { CardNode } from '../flowMapping'
import { useLod } from './useLod'

function ChildBadge({ graphId }: { graphId: string }) {
  const count = useGraphCount(graphId)
  return (
    <span className="node-card-badge">
      <Icon name="branch" size={12} />
      {count}
    </span>
  )
}

export const NodeCard = memo(function NodeCard({ data, selected }: NodeProps<CardNode>) {
  const node = useContentStore((s) => s.nodes.get(data.nodeId))
  const kind = useContentStore((s) => (node?.kindId ? s.kinds.get(node.kindId) : undefined))
  const lod = useLod()
  if (!node) return null
  return (
    <div
      className={`node-card${selected ? ' node-card--selected' : ''}`}
      style={kind ? { borderTopColor: kind.color } : undefined}
    >
      <Handle type="target" position={Position.Left} />
      <div className="node-card-header">
        {kind && <span className="node-card-icon">{kind.icon}</span>}
        <span className="node-card-title">{node.title}</span>
        {node.childGraphId && <ChildBadge graphId={node.childGraphId} />}
      </div>
      {lod === 'near' && node.tags.length > 0 && (
        <div className="node-card-tags">
          {node.tags.map((tag) => (
            <span key={tag} className="node-card-tag">
              {tag}
            </span>
          ))}
        </div>
      )}
      {/* The card shows the authored summary, never the payload itself (§5). */}
      {lod === 'near' && node.summary && <div className="node-card-excerpt">{node.summary}</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  )
})
