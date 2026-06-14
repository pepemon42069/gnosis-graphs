import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'
import { memo } from 'react'
import { useContentStore } from '../../data/react/contentStore'
import type { RelationEdgeType } from '../flowMapping'

export const RelationEdge = memo(function RelationEdge(props: EdgeProps<RelationEdgeType>) {
  const relationType = useContentStore((s) =>
    props.data ? s.relationTypes.get(props.data.relationTypeId) : undefined,
  )
  const [path, labelX, labelY] = getBezierPath(props)
  // mapEdges owns the arrowhead color (it resolves the same relation type and
  // falls back to the resolved --muted), so the stroke's var(--muted) agrees.
  const color = relationType?.color ?? 'var(--muted)'
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        style={{ stroke: color, strokeWidth: props.selected ? 2.5 : 1.5, ...props.style }}
      />
      {relationType && (
        <EdgeLabelRenderer>
          <div
            className={`relation-edge-label${props.selected ? ' relation-edge-label--selected' : ''}`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              color,
            }}
          >
            {relationType.name}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
})
