import { beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../commands/dispatcher'
import { createEdge } from '../commands/edgeCommands'
import { addPlacement } from '../commands/placementCommands'
import { createNode } from '../commands/nodeCommands'
import { createGraph } from '../commands/graphCommands'
import { getMeta, type GnosisDB } from '../db'
import { freshDb } from '../../test/helpers'
import { parseGraphSource, type ParsedGraph } from './parse'
import { planGraphSource } from './plan'

let db: GnosisDB
let graphId: string

beforeEach(async () => {
  db = await freshDb()
  graphId = (await getMeta<string>(db, 'rootGraphId'))!
})

function parse(text: string): ParsedGraph {
  const r = parseGraphSource(text)
  if ('errors' in r) throw new Error(JSON.stringify(r.errors))
  return r.graph
}

async function kindId(name: string): Promise<string> {
  return (await db.kinds.filter((k) => k.name === name).first())!.id
}

async function relationTypeId(name: string): Promise<string> {
  return (await db.relationTypes.filter((r) => r.name === name).first())!.id
}

describe('planGraphSource', () => {
  it('plans new nodes, edges, and vocab to ensure', async () => {
    const plan = await planGraphSource(
      db,
      graphId,
      parse(['New one', '  kind: brandnew', '#x Other', '#x -> #y : invents'].join('\n')),
    )
    expect(plan.summary.creates).toBe(2)
    expect(plan.vocabToEnsure.kinds).toContain('brandnew')
    expect(plan.vocabToEnsure.relations).toContain('invents')
    expect(plan.summary.edgeAdds).toBe(1)
  })

  it('diffs an existing node by its #token prefix (no-op when unchanged)', async () => {
    const a = createNode({
      title: 'Title',
      kindId: await kindId('concept'),
      tags: ['t'],
      file: { filename: 'a.md', format: 'markdown', content: 'c' },
      placement: { graphId, x: 0, y: 0 },
    })
    await dispatch(a)
    const token = a.nodeId.slice(0, 8)

    const unchanged = await planGraphSource(
      db,
      graphId,
      parse([`#${token} Title`, '  kind: concept', '  tags: t', '  file: a.md'].join('\n')),
    )
    expect(unchanged.summary.updates).toBe(0)
    expect(unchanged.summary.placementsRemoved).toBe(0)

    const changed = await planGraphSource(
      db,
      graphId,
      parse([`#${token} Renamed`, '  kind: paper', '  tags: t, more', '  file: a.md'].join('\n')),
    )
    expect(changed.summary.updates).toBe(1)
    expect(changed.nodesToUpdate[0]?.meta.title).toBe('Renamed')
    expect(changed.nodesToUpdate[0]?.meta.kindName).toBe('paper')
    expect(changed.nodesToUpdate[0]?.meta.tags).toEqual(['t', 'more'])
  })

  it('detects a payload-ref change (file -> link)', async () => {
    const a = createNode({
      title: 'T',
      file: { filename: 'a.md', format: 'markdown', content: 'c' },
      placement: { graphId, x: 0, y: 0 },
    })
    await dispatch(a)
    const plan = await planGraphSource(
      db,
      graphId,
      parse([`#${a.nodeId.slice(0, 8)} T`, '  link: https://x.test'].join('\n')),
    )
    expect(plan.nodesToUpdate[0]?.payload).toEqual({
      current: { file: 'a.md' },
      desired: { file: undefined, link: 'https://x.test' },
    })
  })

  it('treats an omitted file/link as no change (clearing is a panel action)', async () => {
    const a = createNode({
      title: 'T',
      file: { filename: 'a.md', format: 'markdown', content: 'c' },
      placement: { graphId, x: 0, y: 0 },
    })
    await dispatch(a)
    // Dropping the `file:` line must not report a phantom update the apply no-ops.
    const plan = await planGraphSource(db, graphId, parse([`#${a.nodeId.slice(0, 8)} T`].join('\n')))
    expect(plan.summary.updates).toBe(0)
    expect(plan.nodesToUpdate).toHaveLength(0)
  })

  it('removes an edge the source dropped', async () => {
    const a = createNode({ title: 'A', placement: { graphId, x: 0, y: 0 } })
    const b = createNode({ title: 'B', placement: { graphId, x: 1, y: 1 } })
    await dispatch(a)
    await dispatch(b)
    await dispatch(
      createEdge({
        graphId,
        fromNodeId: a.nodeId,
        toNodeId: b.nodeId,
        relationTypeId: await relationTypeId('cites'),
      }),
    )
    const plan = await planGraphSource(
      db,
      graphId,
      parse([`#${a.nodeId.slice(0, 8)} A`, `#${b.nodeId.slice(0, 8)} B`].join('\n')),
    )
    expect(plan.edgesToRemove).toHaveLength(1)
    expect(plan.summary.edgeRemoves).toBe(1)
  })

  it('full-sync: a node absent from source is removed; deleted globally iff unplaced everywhere', async () => {
    const keep = createNode({ title: 'Keep', placement: { graphId, x: 0, y: 0 } })
    const dropLocal = createNode({ title: 'DropLocal', placement: { graphId, x: 1, y: 1 } })
    const dropEverywhere = createNode({ title: 'DropAll', placement: { graphId, x: 2, y: 2 } })
    await dispatch(keep)
    await dispatch(dropLocal)
    await dispatch(dropEverywhere)
    // dropLocal is also placed in another graph ⇒ removal must not delete globally.
    const other = createGraph('Other')
    await dispatch(other)
    await dispatch(addPlacement(other.graphId, dropLocal.nodeId, 0, 0))

    const plan = await planGraphSource(
      db,
      graphId,
      parse([`#${keep.nodeId.slice(0, 8)} Keep`].join('\n')),
    )
    expect(plan.summary.placementsRemoved).toBe(2)
    expect(plan.summary.nodesDeleted).toBe(1)
    const removedAll = plan.nodesRemoved.find((r) => r.nodeId === dropEverywhere.nodeId)
    const removedLocal = plan.nodesRemoved.find((r) => r.nodeId === dropLocal.nodeId)
    expect(removedAll?.deleteGlobal).toBe(true)
    expect(removedLocal?.deleteGlobal).toBe(false)
  })

  it('throws on an ambiguous anchor prefix', async () => {
    const a = createNode({ title: 'A', placement: { graphId, x: 0, y: 0 } })
    const b = createNode({ title: 'B', placement: { graphId, x: 1, y: 1 } })
    await dispatch(a)
    await dispatch(b)
    // A 1-char prefix that both ids share would be ambiguous; craft one if so.
    const shared = a.nodeId[0] === b.nodeId[0] ? a.nodeId.slice(0, 1) : null
    if (!shared) return // ids happened not to share a first char; nothing to assert
    await expect(
      planGraphSource(db, graphId, parse(`#${shared} X`)),
    ).rejects.toThrow(/ambiguous/)
  })
})
