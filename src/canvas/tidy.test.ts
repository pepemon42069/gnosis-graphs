import { describe, expect, it } from 'vitest'
import type { EdgeRecord, PlacementRecord } from '../data/types'
import { boundingBoxOrigin, tidyScope, translateToOrigin } from './useTidy'

function placement(nodeId: string, x = 0, y = 0): PlacementRecord {
  return { id: `p-${nodeId}`, graphId: 'g', nodeId, x, y, createdAt: 0, updatedAt: 0 }
}

function edge(id: string, fromNodeId: string, toNodeId: string): EdgeRecord {
  return { id, graphId: 'g', fromNodeId, toNodeId, relationTypeId: 'rt', createdAt: 0, updatedAt: 0 }
}

describe('tidyScope', () => {
  const placements = [placement('a'), placement('b'), placement('c')]
  const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')]

  it('covers the whole graph when nothing is selected', () => {
    const scope = tidyScope(placements, edges, [])
    expect(scope.placements).toEqual(placements)
    expect(scope.edges).toEqual(edges)
  })

  it('scopes a single-node selection to that node — everything else stays put (§5)', () => {
    const scope = tidyScope(placements, edges, ['a'])
    expect(scope.placements.map((p) => p.nodeId)).toEqual(['a'])
    expect(scope.edges).toEqual([])
  })

  it('scopes a multi-node selection to the induced subgraph', () => {
    const scope = tidyScope(placements, edges, ['a', 'b'])
    expect(scope.placements.map((p) => p.nodeId)).toEqual(['a', 'b'])
    expect(scope.edges.map((e) => e.id)).toEqual(['e1'])
  })

  it('drops self-edges', () => {
    const scope = tidyScope(placements, [edge('loop', 'a', 'a'), ...edges], [])
    expect(scope.edges.map((e) => e.id)).toEqual(['e1', 'e2'])
  })

  it('drops edges referencing unplaced nodes', () => {
    const scope = tidyScope(placements, [edge('dangling', 'a', 'ghost'), ...edges], [])
    expect(scope.edges.map((e) => e.id)).toEqual(['e1', 'e2'])
  })
})

describe('boundingBoxOrigin', () => {
  it('returns the minimum x and y across points', () => {
    expect(
      boundingBoxOrigin([
        { x: 10, y: 50 },
        { x: 30, y: 20 },
      ]),
    ).toEqual({ x: 10, y: 20 })
  })
})

describe('translateToOrigin', () => {
  it('shifts coordinates so the bounding-box top-left lands on the origin', () => {
    const translated = translateToOrigin(
      [
        { id: 'a', x: 12, y: 12 },
        { id: 'b', x: 112, y: 62 },
      ],
      { x: 300, y: 200 },
    )
    expect(translated).toEqual([
      { id: 'a', x: 300, y: 200 },
      { id: 'b', x: 400, y: 250 },
    ])
  })

  it('keeps coordinates already at the origin unchanged', () => {
    const nodes = [
      { id: 'a', x: 5, y: 7 },
      { id: 'b', x: 25, y: 7 },
    ]
    expect(translateToOrigin(nodes, { x: 5, y: 7 })).toEqual(nodes)
  })
})
