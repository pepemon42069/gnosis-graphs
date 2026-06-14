import { createEdge } from '../src/data/commands/edgeCommands'
import { createGraph } from '../src/data/commands/graphCommands'
import { createKind } from '../src/data/commands/kindCommands'
import { createNode } from '../src/data/commands/nodeCommands'
import { createRelationType } from '../src/data/commands/relationTypeCommands'
import { composite } from '../src/data/commands/composite'
import type { Command } from '../src/data/commands/types'
import { slug } from '../src/data/files/slug'
import { kindPreset } from '../src/data/kindPresets'
import { nextPlacementPosition } from '../src/data/source/layout'
import { ensureVocabInline } from './vocab'

/** One decomposed concept → one node with its own markdown file + metadata. */
interface DecomposeConcept {
  /** Stable handle used by relations to reference this concept. */
  key: string
  title: string
  kind?: string
  tags?: string[]
  summary?: string
  filename?: string
  content: string
  /** Pre-computed canvas position (the /api/decompose route lays out first); falls
   *  back to the grid when absent. */
  position?: { x: number; y: number }
}

/** A typed, directed relation between two concepts, by their keys. */
interface DecomposeRelation {
  from: string
  to: string
  type: string
}

export interface DecomposeInput {
  graphName: string
  concepts: DecomposeConcept[]
  relations: DecomposeRelation[]
}

export interface DecomposeCommand extends Command {
  graphId: string
}

function filenameFor(concept: DecomposeConcept): string {
  if (concept.filename) return concept.filename
  return `${slug(concept.title, 'concept')}.md`
}

/**
 * Materialize a decomposed markdown document as a brand-new graph: one
 * node-with-file per concept, linked by typed directed edges — all as ONE undo
 * step. Pure creation (never touches existing data), so it sidesteps the DSL's
 * full-sync deletion. Mirrors server/graphSource.ts: vocab is created INLINE,
 * each sub-command joins `executed[]`, and undo reverses them. The new graphId is
 * captured at do()-time and exposed for the command result.
 */
export function buildDecomposeCommand(input: DecomposeInput): DecomposeCommand {
  const seen = new Set<string>()
  for (const concept of input.concepts) {
    if (seen.has(concept.key)) throw new Error(`duplicate concept key: ${concept.key}`)
    seen.add(concept.key)
  }
  let graphId = ''
  const command = composite(
    'decompose-into-graph',
    async (run, db) => {
      // (1) the new graph — its id anchors every placement, edge, and the result.
      const graphCmd = createGraph(input.graphName)
      await run(graphCmd)
      graphId = graphCmd.graphId

      // (2) vocab inline — concept kinds + relation types (case-insensitive reuse).
      const kindIdByName = await ensureVocabInline(
        db.kinds,
        input.concepts.flatMap((c) => (c.kind ? [c.kind] : [])),
        (name) => {
          const { color, icon } = kindPreset(name)
          return createKind(name, color, icon)
        },
        (c) => c.kindId,
        run,
      )
      const relationIdByName = await ensureVocabInline(
        db.relationTypes,
        input.relations.map((r) => r.type),
        (name) => createRelationType(name),
        (c) => c.relationTypeId,
        run,
      )

      // (3) one node-with-file per concept, grid-placed; record key → nodeId.
      const nodeIdByKey = new Map<string, string>()
      for (let i = 0; i < input.concepts.length; i++) {
        const concept = input.concepts[i]
        const pos = concept.position ?? nextPlacementPosition([], i)
        const node = createNode({
          title: concept.title,
          kindId: concept.kind ? kindIdByName.get(concept.kind.toLowerCase()) : undefined,
          tags: concept.tags,
          summary: concept.summary,
          file: { filename: filenameFor(concept), format: 'markdown', content: concept.content },
          placement: { graphId, x: pos.x, y: pos.y },
        })
        await run(node)
        nodeIdByKey.set(concept.key, node.nodeId)
      }

      // (4) typed directed edges between concepts.
      for (const relation of input.relations) {
        const fromNodeId = nodeIdByKey.get(relation.from)
        const toNodeId = nodeIdByKey.get(relation.to)
        if (!fromNodeId || !toNodeId) {
          throw new Error(
            `relation references unknown concept key (${relation.from} -> ${relation.to})`,
          )
        }
        await run(
          createEdge({
            graphId,
            fromNodeId,
            toNodeId,
            relationTypeId: relationIdByName.get(relation.type.toLowerCase())!,
          }),
        )
      }

    },
  ) as DecomposeCommand
  Object.defineProperty(command, 'graphId', { get: () => graphId, enumerable: true })
  return command
}
