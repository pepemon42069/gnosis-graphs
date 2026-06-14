import { beforeEach, describe, expect, it } from 'vitest'
import { dispatch, redo, undo } from '../src/data/commands/dispatcher'
import { createEdge } from '../src/data/commands/edgeCommands'
import { createGraph } from '../src/data/commands/graphCommands'
import { addPlacement } from '../src/data/commands/placementCommands'
import { createNode } from '../src/data/commands/nodeCommands'
import { getMeta, type GnosisDB } from '../src/data/db'
import { freshDb } from '../src/test/helpers'
import { parseGraphSource, type ParsedGraph } from '../src/data/source/parse'
import { planGraphSource } from '../src/data/source/plan'
import { serializeGraphSource } from '../src/data/source/serialize'
import { buildApplyCommand } from './graphSource'

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

async function apply(text: string): Promise<void> {
  await dispatch(buildApplyCommand(graphId, parse(text)))
}

async function nodeByTitle(title: string) {
  return (await db.nodes.filter((n) => n.title === title).first())!
}

describe('buildApplyCommand', () => {
  it('creates a new node + edge, mints vocab inline, and one undo fully reverts', async () => {
    const before = {
      nodes: await db.nodes.count(),
      placements: await db.placements.count(),
      edges: await db.edges.count(),
      kinds: await db.kinds.count(),
      relations: await db.relationTypes.count(),
    }
    await apply(
      [
        '#t Transformers',
        '  kind: novelkind',
        '  file: transformers.md',
        '',
        '#x Attention',
        '  kind: paper',
        '',
        '#t -> #x : novelrelation',
      ].join('\n'),
    )

    // Two nodes created, one edge whose endpoints are both new aliases (t,x).
    expect(await db.nodes.count()).toBe(before.nodes + 2)
    expect(await db.placements.count()).toBe(before.placements + 2)
    const t = await nodeByTitle('Transformers')
    expect(t.payload?.kind).toBe('file')
    const file = await db.files.get((t.payload as { fileId: string }).fileId)
    expect(file).toMatchObject({ filename: 'transformers.md', format: 'markdown' })
    // novelkind + novelrelation minted inline (case-insensitive, no dup).
    expect(await db.kinds.count()).toBe(before.kinds + 1)
    expect(await db.relationTypes.count()).toBe(before.relations + 1)
    expect(await db.edges.count()).toBe(before.edges + 1)

    await undo()
    expect(await db.nodes.count()).toBe(before.nodes)
    expect(await db.placements.count()).toBe(before.placements)
    expect(await db.edges.count()).toBe(before.edges)
    expect(await db.kinds.count()).toBe(before.kinds)
    expect(await db.relationTypes.count()).toBe(before.relations)

    // redo re-applies cleanly (do() recomputes the plan + resets capture).
    await redo()
    expect(await db.nodes.count()).toBe(before.nodes + 2)
    expect(await db.edges.count()).toBe(before.edges + 1)
    expect(await db.kinds.count()).toBe(before.kinds + 1)
  })

  it('renames a file in place (preserving content) on a filename-only change', async () => {
    const a = createNode({
      title: 'Doc',
      file: { filename: 'a.md', format: 'markdown', content: 'keep me' },
      placement: { graphId, x: 0, y: 0 },
    })
    await dispatch(a)
    const token = a.nodeId.slice(0, 8)
    await apply([`#${token} Doc`, '  file: renamed.md'].join('\n'))
    const file = await db.files.where('nodeId').equals(a.nodeId).first()
    expect(file).toMatchObject({ filename: 'renamed.md', content: 'keep me' })
  })

  it('switches a file payload to a link', async () => {
    const a = createNode({
      title: 'Doc',
      file: { filename: 'a.md', format: 'markdown', content: 'c' },
      placement: { graphId, x: 0, y: 0 },
    })
    await dispatch(a)
    await apply([`#${a.nodeId.slice(0, 8)} Doc`, '  link: https://x.test'].join('\n'))
    const node = await db.nodes.get(a.nodeId)
    expect(node?.payload).toEqual({ kind: 'link', url: 'https://x.test' })
  })

  it('full-sync deletes a placement and the global node + files iff unplaced everywhere', async () => {
    const keep = createNode({ title: 'Keep', placement: { graphId, x: 0, y: 0 } })
    const dropAll = createNode({
      title: 'DropAll',
      file: { filename: 'd.md', format: 'markdown', content: 'x' },
      placement: { graphId, x: 1, y: 1 },
    })
    const dropLocal = createNode({ title: 'DropLocal', placement: { graphId, x: 2, y: 2 } })
    await dispatch(keep)
    await dispatch(dropAll)
    await dispatch(dropLocal)
    const dropAllFileId = (await db.nodes.get(dropAll.nodeId))!.payload as { fileId: string }
    const other = createGraph('Other')
    await dispatch(other)
    await dispatch(addPlacement(other.graphId, dropLocal.nodeId, 0, 0))
    await dispatch(
      createEdge({
        graphId,
        fromNodeId: keep.nodeId,
        toNodeId: dropAll.nodeId,
        relationTypeId: (await db.relationTypes.filter((r) => r.name === 'cites').first())!.id,
      }),
    )

    await apply(`#${keep.nodeId.slice(0, 8)} Keep`)

    // dropAll: unplaced everywhere ⇒ node + its file are gone; the edge is gone.
    expect(await db.nodes.get(dropAll.nodeId)).toBeUndefined()
    expect(await db.files.get(dropAllFileId.fileId)).toBeUndefined()
    expect(await db.edges.where('graphId').equals(graphId).count()).toBe(0)
    // dropLocal: still placed in Other ⇒ node survives, only this placement drops.
    expect(await db.nodes.get(dropLocal.nodeId)).toBeDefined()
    expect(await db.placements.where('nodeId').equals(dropLocal.nodeId).count()).toBe(1)

    await undo()
    expect(await db.nodes.get(dropAll.nodeId)).toBeDefined()
    expect(await db.files.get(dropAllFileId.fileId)).toBeDefined()
    expect(await db.placements.where('graphId').equals(graphId).count()).toBe(3)
    expect(await db.edges.where('graphId').equals(graphId).count()).toBe(1)
  })

  it('round-trips: serialize then re-plan is a no-op on a non-trivial graph', async () => {
    await apply(
      [
        '#a One',
        '  kind: paper',
        '  file: one.md',
        '',
        '#b Two',
        '  link: https://two.test',
        '',
        '#a -> #b : cites',
      ].join('\n'),
    )
    const text = await serializeGraphSource(db, graphId)
    expect('graph' in parseGraphSource(text)).toBe(true)

    // Re-planning the serialized text against the same graph touches nothing.
    const { summary } = await planGraphSource(db, graphId, parse(text))
    expect(summary).toEqual({
      creates: 0,
      updates: 0,
      edgeAdds: 0,
      edgeRemoves: 0,
      placementsRemoved: 0,
      nodesDeleted: 0,
    })
  })
})
