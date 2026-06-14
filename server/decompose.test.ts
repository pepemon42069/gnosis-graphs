import { beforeEach, describe, expect, it } from 'vitest'
import { dispatch, redo, undo } from '../src/data/commands/dispatcher'
import { createKind } from '../src/data/commands/kindCommands'
import { createRelationType } from '../src/data/commands/relationTypeCommands'
import type { GnosisDB } from '../src/data/db'
import { freshDb } from '../src/test/helpers'
import { buildDecomposeCommand, type DecomposeInput } from './decompose'

let db: GnosisDB

beforeEach(async () => {
  db = await freshDb()
})

async function counts() {
  return {
    graphs: await db.graphs.count(),
    nodes: await db.nodes.count(),
    files: await db.files.count(),
    placements: await db.placements.count(),
    edges: await db.edges.count(),
    kinds: await db.kinds.count(),
    relations: await db.relationTypes.count(),
  }
}

const SAMPLE: DecomposeInput = {
  graphName: 'Decomposed Doc',
  concepts: [
    { key: 'a', title: 'Alpha', kind: 'novelidea', tags: ['x'], summary: 'first', content: '# Alpha\nbody a' },
    { key: 'b', title: 'Beta', kind: 'novelidea', content: 'body b' },
    { key: 'c', title: 'Gamma', kind: 'novelclaim', content: 'body c' },
  ],
  relations: [
    { from: 'a', to: 'b', type: 'novelrel' },
    { from: 'b', to: 'c', type: 'novelrel' },
  ],
}

describe('buildDecomposeCommand', () => {
  it('materializes a new graph of concept-nodes + typed edges, mints vocab inline, one undo reverts', async () => {
    const before = await counts()
    const command = buildDecomposeCommand(SAMPLE)
    await dispatch(command)

    // One new graph, one node-with-file per concept, grid placements, typed edges.
    const after = await counts()
    expect(after.graphs).toBe(before.graphs + 1)
    expect(after.nodes).toBe(before.nodes + 3)
    expect(after.files).toBe(before.files + 3)
    expect(after.placements).toBe(before.placements + 3)
    expect(after.edges).toBe(before.edges + 2)
    // novelidea (deduped across two concepts) + novelclaim → 2 kinds; novelrel → 1.
    expect(after.kinds).toBe(before.kinds + 2)
    expect(after.relations).toBe(before.relations + 1)

    // The result exposes the new graphId.
    expect(command.graphId).toMatch(/[0-9a-f-]{36}/)
    expect(await db.graphs.get(command.graphId)).toMatchObject({ name: 'Decomposed Doc' })

    // Each node carries a non-empty markdown file + its metadata.
    const alpha = (await db.nodes.filter((n) => n.title === 'Alpha').first())!
    expect(alpha.summary).toBe('first')
    expect(alpha.tags).toEqual(['x'])
    expect(alpha.payload?.kind).toBe('file')
    const file = await db.files.get((alpha.payload as { fileId: string }).fileId)
    expect(file).toMatchObject({ filename: 'alpha.md', format: 'markdown', content: '# Alpha\nbody a' })

    // One undo fully reverts (graph, nodes, files, placements, edges, run-created vocab).
    await undo()
    expect(await counts()).toEqual(before)

    // redo re-applies cleanly.
    await redo()
    const again = await counts()
    expect(again.nodes).toBe(before.nodes + 3)
    expect(again.edges).toBe(before.edges + 2)
    expect(again.kinds).toBe(before.kinds + 2)
  })

  it('reuses existing vocab case-insensitively instead of duplicating', async () => {
    await dispatch(createKind('Topic', '#abcabc', '*'))
    await dispatch(createRelationType('Relates'))
    const before = await counts()

    await dispatch(
      buildDecomposeCommand({
        graphName: 'G',
        concepts: [
          { key: 'a', title: 'A', kind: 'topic', content: 'a' },
          { key: 'b', title: 'B', kind: 'TOPIC', content: 'b' },
        ],
        relations: [{ from: 'a', to: 'b', type: 'relates' }],
      }),
    )

    const after = await counts()
    expect(after.kinds).toBe(before.kinds) // Topic reused, no duplicate
    expect(after.relations).toBe(before.relations) // Relates reused, no duplicate
    expect(after.edges).toBe(before.edges + 1)
  })

  it('throws when a relation references an unknown concept key', async () => {
    const command = buildDecomposeCommand({
      graphName: 'G',
      concepts: [{ key: 'a', title: 'A', content: 'a' }],
      relations: [{ from: 'a', to: 'missing', type: 'rel' }],
    })
    await expect(dispatch(command)).rejects.toThrow(/unknown concept key/)
  })

  it('rejects duplicate concept keys at construction', () => {
    expect(() =>
      buildDecomposeCommand({
        graphName: 'G',
        concepts: [
          { key: 'a', title: 'A', content: 'a' },
          { key: 'a', title: 'B', content: 'b' },
        ],
        relations: [],
      }),
    ).toThrow(/duplicate concept key/)
  })
})
