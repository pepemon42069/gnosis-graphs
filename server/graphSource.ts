import { createEdge, deleteEdges } from '../src/data/commands/edgeCommands'
import { renameNodeFile, setNodeFile, setNodeLink } from '../src/data/commands/fileCommands'
import { composite } from '../src/data/commands/composite'
import { createKind } from '../src/data/commands/kindCommands'
import { kindPreset } from '../src/data/kindPresets'
import {
  createNode,
  deleteNodeEverywhere,
  updateNodeMeta,
} from '../src/data/commands/nodeCommands'
import { removeFromCanvas } from '../src/data/commands/placementCommands'
import { createRelationType } from '../src/data/commands/relationTypeCommands'
import type { Command } from '../src/data/commands/types'
import { formatForExt } from '../src/data/files/formatForExt'
import { placementsByGraph } from '../src/data/queries'
import { nextPlacementPosition } from '../src/data/source/layout'
import type { ParsedGraph, ParsedNode } from '../src/data/source/parse'
import { type NodeUpdate, planGraphSource } from '../src/data/source/plan'
import { ensureVocabInline } from './vocab'

/**
 * One graph-source apply = one composite Command = one undo step. do() is
 * re-runnable (redo): it recomputes the plan from current DB state, resets its
 * capture, runs each sub-command in order, and records it for a reverse-order
 * undo. Vocab is created INLINE (never ensureKind/ensureRelationType — those
 * open their own transaction + push their own undo step). Content is never
 * written: only file/link references move.
 */
export function buildApplyCommand(graphId: string, parsed: ParsedGraph): Command {
  let cascades = false
  return composite(
    'apply-graph-source',
    async (run, db) => {
      cascades = false
      const plan = await planGraphSource(db, graphId, parsed)
      cascades = plan.nodesRemoved.length > 0

      // (a) vocab inline — case-insensitive lookup, create missing within this txn.
      const kindIdByName = await ensureVocabInline(
        db.kinds,
        plan.vocabToEnsure.kinds,
        (name) => {
          const { color, icon } = kindPreset(name)
          return createKind(name, color, icon)
        },
        (c) => c.kindId,
        run,
      )
      const relationIdByName = await ensureVocabInline(
        db.relationTypes,
        plan.vocabToEnsure.relations,
        (name) => createRelationType(name),
        (c) => c.relationTypeId,
        run,
      )
      const kindIdFor = (name?: string) => (name ? kindIdByName.get(name.toLowerCase()) : undefined)
      const relationIdFor = (name: string) => relationIdByName.get(name.toLowerCase())!

      // (b) create new nodes. createNode mints its id synchronously, so the
      // token→nodeId map is complete before any edge resolves.
      const tokenToNodeId = new Map(plan.resolved)
      const existing = await placementsByGraph(graphId)
      const nodeCreates = plan.nodesToCreate.map((create, i) => {
        const pos = nextPlacementPosition(existing, i)
        const command = createNode({
          title: create.parsed.title,
          kindId: kindIdFor(create.parsed.kind),
          tags: create.parsed.tags,
          ...payloadOf(create.parsed),
          placement: { graphId, x: pos.x, y: pos.y },
        })
        if (create.alias) tokenToNodeId.set(create.alias, command.nodeId)
        return command
      })
      for (const command of nodeCreates) await run(command)

      // (c) update changed existing nodes: meta then payload reference.
      for (const update of plan.nodesToUpdate) {
        if (Object.keys(update.meta).length) {
          await run(updateNodeMeta(update.nodeId, metaPatch(update, kindIdFor)))
        }
        const ref = update.payload
        if (ref) await applyPayloadRef(update, ref, run)
      }

      // (d) add new edges / remove dropped edges, resolving endpoints via the map.
      for (const edge of plan.edgesToAdd) {
        const fromNodeId = tokenToNodeId.get(edge.from)
        const toNodeId = tokenToNodeId.get(edge.to)
        if (!fromNodeId || !toNodeId) {
          throw new Error(`line ${edge.line}: edge endpoint not found (#${edge.from} -> #${edge.to})`)
        }
        await run(
          createEdge({ graphId, fromNodeId, toNodeId, relationTypeId: relationIdFor(edge.relation) }),
        )
      }
      if (plan.edgesToRemove.length) await run(deleteEdges(plan.edgesToRemove))

      // (e) full-sync removals: drop the placement (+ this graph's touching edges);
      // delete the global node + files when it is now unplaced everywhere.
      for (const removal of plan.nodesRemoved) {
        await run(removeFromCanvas([removal.placementId], removal.edgeIds))
        if (removal.deleteGlobal) await run(deleteNodeEverywhere(removal.nodeId))
      }
    },
    { cascade: () => cascades },
  )
}

function metaPatch(
  update: NodeUpdate,
  kindIdFor: (name?: string) => string | undefined,
): Parameters<typeof updateNodeMeta>[1] {
  const { title, summary, tags, kindName } = update.meta
  return {
    ...(title !== undefined ? { title } : {}),
    ...(summary !== undefined ? { summary } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(kindName !== undefined ? { kindId: kindName === null ? null : kindIdFor(kindName) ?? null } : {}),
  }
}

/** Move a node's payload reference. Rename in place when only the filename
 *  changes (preserves content); otherwise switch file↔link or set a fresh file. */
async function applyPayloadRef(
  update: NodeUpdate,
  ref: NonNullable<NodeUpdate['payload']>,
  run: (c: Command) => Promise<void>,
): Promise<void> {
  const { current, desired } = ref
  if (desired.link !== undefined) {
    await run(setNodeLink(update.nodeId, desired.link))
    return
  }
  if (desired.file !== undefined) {
    const { format, language } = formatForExt(desired.file)
    // A pure filename change on an existing file keeps its content.
    if (current.file !== undefined && current.link === undefined) {
      await run(renameNodeFile(update.nodeId, desired.file, format, language))
    } else {
      await run(setNodeFile(update.nodeId, desired.file, format, language))
    }
    return
  }
  // A payload update always specifies a file or link: the plan treats an omitted
  // reference as no-change, so a "cleared" payload never reaches here.
}

function payloadOf(node: ParsedNode): {
  file?: { filename: string; format: 'markdown' | 'plaintext' | 'code'; language?: string; content: string }
  link?: string
} {
  if (node.link !== undefined) return { link: node.link }
  if (node.file !== undefined) {
    const { format, language } = formatForExt(node.file)
    return { file: { filename: node.file, format, ...(language ? { language } : {}), content: '' } }
  }
  return {}
}
