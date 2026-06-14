import { describe, expect, it } from 'vitest'
import type { GraphRecord, NodeRecord } from '../data/types'
import { deriveChildren } from './treeModel'

function makeNode(id: string, title: string, childGraphId?: string): NodeRecord {
  return {
    id,
    title,
    tags: [],
    childGraphId,
    createdAt: 0,
    updatedAt: 0,
  }
}

function makeGraph(id: string, name: string): GraphRecord {
  return { id, name, createdAt: 0, updatedAt: 0 }
}

describe('deriveChildren', () => {
  it('splits subgraph folders from leaves, sorted, folders deduped', () => {
    const graphs = new Map([
      ['g1', makeGraph('g1', 'Zeta')],
      ['g2', makeGraph('g2', 'Alpha')],
    ])
    const nodes = [
      makeNode('n1', 'banana'),
      makeNode('n2', 'into zeta', 'g1'),
      makeNode('n3', 'apple'),
      makeNode('n4', 'also into zeta', 'g1'),
      makeNode('n5', 'into alpha', 'g2'),
      undefined,
    ]
    const { folders, leaves } = deriveChildren(nodes, graphs)
    expect(folders.map((f) => f.graph.name)).toEqual(['Alpha', 'Zeta'])
    expect(leaves.map((n) => n.title)).toEqual(['apple', 'banana'])
  })

  it('degrades a dangling childGraphId to a leaf', () => {
    const { folders, leaves } = deriveChildren([makeNode('n1', 'orphan ref', 'gone')], new Map())
    expect(folders).toEqual([])
    expect(leaves.map((n) => n.id)).toEqual(['n1'])
  })
})
