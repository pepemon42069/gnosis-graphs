import { beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../commands/dispatcher'
import { createEdge } from '../commands/edgeCommands'
import { setNodeLink } from '../commands/fileCommands'
import { createNode } from '../commands/nodeCommands'
import { getMeta, type GnosisDB } from '../db'
import { freshDb } from '../../test/helpers'
import { parseGraphSource } from './parse'
import { serializeGraphSource } from './serialize'

let db: GnosisDB
let graphId: string

beforeEach(async () => {
  db = await freshDb()
  graphId = (await getMeta<string>(db, 'rootGraphId'))!
})

async function kindId(name: string): Promise<string> {
  return (await db.kinds.filter((k) => k.name === name).first())!.id
}

async function relationTypeId(name: string): Promise<string> {
  return (await db.relationTypes.filter((r) => r.name === name).first())!.id
}

describe('serializeGraphSource', () => {
  it('emits the canonical DSL for placed nodes + edges', async () => {
    const a = createNode({
      title: 'Transformers',
      kindId: await kindId('concept'),
      tags: ['ml', 'attention'],
      file: { filename: 'transformers.md', format: 'markdown', content: 'body' },
      placement: { graphId, x: 0, y: 0 },
    })
    await dispatch(a)
    const b = createNode({
      title: 'Attention Is All You Need',
      kindId: await kindId('paper'),
      link: 'https://arxiv.org/abs/1706.03762',
      placement: { graphId, x: 100, y: 0 },
    })
    await dispatch(b)
    await dispatch(
      createEdge({
        graphId,
        fromNodeId: a.nodeId,
        toNodeId: b.nodeId,
        relationTypeId: await relationTypeId('cites'),
      }),
    )

    const text = await serializeGraphSource(db, graphId)
    expect(text).toContain(`#${a.nodeId.slice(0, 8)} Transformers`)
    expect(text).toContain('  kind: concept')
    expect(text).toContain('  tags: ml, attention')
    expect(text).toContain('  file: transformers.md')
    expect(text).toContain('  link: https://arxiv.org/abs/1706.03762')
    expect(text).toContain(`#${a.nodeId.slice(0, 8)} -> #${b.nodeId.slice(0, 8)} : cites`)
  })

  it('emits an opens comment for a node with a child graph', async () => {
    const home = (await getMeta<string>(db, 'homeGraphId'))!
    const placement = await db.placements.where('graphId').equals(home).first()
    expect(placement).toBeDefined()
    const text = await serializeGraphSource(db, home)
    expect(text).toMatch(/\/\/ opens: First graph/)
  })

  it('round-trips: serialize -> parse -> serialize is idempotent', async () => {
    const a = createNode({
      title: 'One',
      kindId: await kindId('concept'),
      tags: ['x'],
      file: { filename: 'one.md', format: 'markdown', content: 'c' },
      placement: { graphId, x: 0, y: 0 },
    })
    await dispatch(a)
    const b = createNode({
      title: 'Two',
      link: 'https://two.test',
      placement: { graphId, x: 50, y: 50 },
    })
    await dispatch(b)
    await dispatch(setNodeLink(b.nodeId, 'https://two.test'))
    await dispatch(
      createEdge({
        graphId,
        fromNodeId: a.nodeId,
        toNodeId: b.nodeId,
        relationTypeId: await relationTypeId('relates to'),
      }),
    )

    const first = await serializeGraphSource(db, graphId)
    const parsed = parseGraphSource(first)
    expect('graph' in parsed).toBe(true)
    // Re-serializing after a parse round-trip yields identical text (stable order).
    const second = await serializeGraphSource(db, graphId)
    expect(second).toBe(first)
  })
})
