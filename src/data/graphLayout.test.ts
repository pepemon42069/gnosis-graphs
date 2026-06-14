import { describe, expect, it } from 'vitest'
import { elkLayout, estimateNodeSize, type LayoutStyle, removeOverlaps } from './graphLayout'

describe('estimateNodeSize', () => {
  it('clamps width to the 140–320 node-card band and grows height with content', () => {
    expect(estimateNodeSize('', false, false).width).toBe(140)
    expect(estimateNodeSize('x'.repeat(200), false, false).width).toBe(320)
    expect(estimateNodeSize('Title', true, true).height).toBeGreaterThan(
      estimateNodeSize('Title', false, false).height,
    )
  })
})

describe('removeOverlaps', () => {
  it('separates overlapping boxes so no pair overlaps', () => {
    const nodes = [
      { id: 'a', x: 0, y: 0, width: 100, height: 40 },
      { id: 'b', x: 10, y: 5, width: 100, height: 40 },
      { id: 'c', x: 5, y: 8, width: 100, height: 40 },
    ]
    removeOverlaps(nodes, 16, 16)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!
        const b = nodes[j]!
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
        const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
        expect(overlapX <= 0.001 || overlapY <= 0.001).toBe(true)
      }
    }
  })
})

describe('elkLayout', () => {
  const graph = {
    nodes: [
      { id: 'a', width: 160, height: 50 },
      { id: 'b', width: 160, height: 50 },
      { id: 'c', width: 160, height: 50 },
      { id: 'd', width: 160, height: 50 },
    ],
    edges: [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
      { id: 'e3', source: 'a', target: 'd' },
    ],
  }

  it.each(['web', 'flow'] as LayoutStyle[])(
    'positions every node with no overlaps (%s)',
    async (style) => {
      const pos = await elkLayout(graph, style)
      expect(pos.size).toBe(4)
      const placed = graph.nodes.map((n) => ({ ...n, ...pos.get(n.id)! }))
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          const a = placed[i]!
          const b = placed[j]!
          const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
          const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
          expect(overlapX <= 0.001 || overlapY <= 0.001).toBe(true)
        }
      }
    },
  )

  it('clustering (web) places same-tag nodes closer than differently-tagged ones', async () => {
    const tagged = {
      nodes: [
        { id: 'a', width: 100, height: 40, tags: ['x'] },
        { id: 'b', width: 100, height: 40, tags: ['x'] },
        { id: 'c', width: 100, height: 40, tags: ['y'] },
        { id: 'd', width: 100, height: 40, tags: ['y'] },
      ],
      edges: [],
    }
    const pos = await elkLayout(tagged, 'web', true)
    const dist = (p: string, q: string) =>
      Math.hypot(pos.get(p)!.x - pos.get(q)!.x, pos.get(p)!.y - pos.get(q)!.y)
    expect(dist('a', 'b')).toBeLessThan(dist('a', 'c'))
    expect(dist('c', 'd')).toBeLessThan(dist('c', 'a'))
  })
})
