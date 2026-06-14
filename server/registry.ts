/// <reference types="node" />
import { canRedo, canUndo, dispatch, redo, undo } from '../src/data/commands/dispatcher'
import {
  createEdge,
  type CreateEdgeOptions,
  deleteEdges,
  retypeEdge,
  reverseEdge,
} from '../src/data/commands/edgeCommands'
import {
  renameNodeFile,
  setFileContent,
  setNodeFile,
  setNodeLink,
} from '../src/data/commands/fileCommands'
import {
  createGraph,
  deleteGraph,
  deleteGraphDeep,
  renameGraph,
} from '../src/data/commands/graphCommands'
import {
  createKind,
  deleteKind,
  ensureKind,
  mergeKind,
  recolorKind,
  renameKind,
} from '../src/data/commands/kindCommands'
import {
  createNode,
  type CreateNodeOptions,
  createSubGraph,
  deleteNodeEverywhere,
  deleteNodesEverywhere,
  linkChildGraph,
  updateNodeMeta,
} from '../src/data/commands/nodeCommands'
import { importMarkdownFolder } from '../src/data/interop/markdownImport'
import {
  addPlacement,
  movePlacements,
  removeFromCanvas,
} from '../src/data/commands/placementCommands'
import { buildDecomposeCommand, type DecomposeInput } from './decompose'
import { setNodeTitle } from '../src/data/commands/payloadCommands'
import {
  createRelationType,
  deleteRelationType,
  ensureRelationType,
  mergeRelationType,
  recolorRelationType,
  renameRelationType,
} from '../src/data/commands/relationTypeCommands'
import type { Command } from '../src/data/commands/types'

type Args = Record<string, unknown>
const a = (args: Args) => args as Record<string, never>

/** Command kind → factory. Mirrors every client-side `dispatch(factory(...))`. */
const FACTORIES: Record<string, (args: Args) => Command> = {
  'create-node': (x) => createNode(x as unknown as CreateNodeOptions),
  'update-node-meta': (x) => updateNodeMeta(x.nodeId as string, a(x).patch),
  'create-sub-graph': (x) => createSubGraph(x.nodeId as string, x.name as string),
  'link-child-graph': (x) => linkChildGraph(x.nodeId as string, x.graphId as string),
  'delete-node-everywhere': (x) => deleteNodeEverywhere(x.nodeId as string),
  'delete-nodes-everywhere': (x) => deleteNodesEverywhere(x.nodeIds as string[]),
  'set-node-title': (x) => setNodeTitle(x.nodeId as string, x.title as string),
  'set-file-content': (x) => setFileContent(x.fileId as string, x.content as string),
  'set-node-file': (x) =>
    setNodeFile(x.nodeId as string, x.filename as string, a(x).format, x.language as string | undefined),
  'rename-node-file': (x) =>
    renameNodeFile(
      x.nodeId as string,
      x.filename as string,
      a(x).format,
      x.language as string | undefined,
    ),
  'set-node-link': (x) => setNodeLink(x.nodeId as string, x.url as string),
  'add-placement': (x) =>
    addPlacement(x.graphId as string, x.nodeId as string, x.x as number, y(x)),
  'move-placements': (x) => movePlacements(a(x).moves),
  'remove-from-canvas': (x) =>
    removeFromCanvas(x.placementIds as string[], (x.edgeIds as string[]) ?? []),
  'create-edge': (x) => createEdge(x as unknown as CreateEdgeOptions),
  'delete-edges': (x) => deleteEdges(x.edgeIds as string[]),
  'retype-edge': (x) => retypeEdge(x.edgeId as string, x.relationTypeId as string),
  'reverse-edge': (x) => reverseEdge(x.edgeId as string),
  'import-markdown-folder': (x) =>
    importMarkdownFolder(x.graphName as string, a(x).files),
  'decompose-into-graph': (x) => buildDecomposeCommand(x as unknown as DecomposeInput),
  'create-graph': (x) => createGraph(x.name as string),
  'rename-graph': (x) => renameGraph(x.graphId as string, x.name as string),
  'delete-graph': (x) => deleteGraph(x.graphId as string),
  'delete-graph-deep': (x) => deleteGraphDeep(x.graphId as string),
  'create-kind': (x) => createKind(x.name as string, x.color as string, x.icon as string),
  'rename-kind': (x) => renameKind(x.id as string, x.name as string),
  'recolor-kind': (x) => recolorKind(x.id as string, a(x).patch),
  'merge-kind': (x) => mergeKind(x.fromId as string, x.intoId as string),
  'delete-kind': (x) => deleteKind(x.id as string),
  'create-relation-type': (x) =>
    createRelationType(x.name as string, x.color as string | undefined),
  'rename-relation-type': (x) => renameRelationType(x.id as string, x.name as string),
  'recolor-relation-type': (x) => recolorRelationType(x.id as string, x.color as string),
  'merge-relation-type': (x) => mergeRelationType(x.fromId as string, x.intoId as string),
  'delete-relation-type': (x) => deleteRelationType(x.id as string),
}

const y = (x: Args) => x.y as number

const RESULT_KEYS = ['nodeId', 'fileId', 'placementId', 'graphId', 'edgeId', 'relationTypeId', 'kindId']
function resultOf(command: Command): Record<string, string> {
  const out: Record<string, string> = {}
  const c = command as unknown as Record<string, unknown>
  for (const k of RESULT_KEYS) if (typeof c[k] === 'string') out[k] = c[k] as string
  return out
}

// Serialise all writes: SQLite transactions must never interleave across
// concurrent HTTP requests (single-user, single connection).
let chain: Promise<unknown> = Promise.resolve()
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.then(
    () => {},
    () => {},
  )
  return run
}

export function runCommand(kind: string, args: Args): Promise<{ result: Record<string, string> }> {
  const factory = FACTORIES[kind]
  if (!factory) throw new Error(`Unknown command kind: ${kind}`)
  return serialize(async () => {
    const command = factory(args)
    await dispatch(command)
    return { result: resultOf(command) }
  })
}

/**
 * Dispatch a pre-built composite Command through the same serialised write chain
 * so it lands on the undo stack and can't interleave with other commands.
 */
export function dispatchComposite(command: Command): Promise<void> {
  return serialize(() => dispatch(command))
}

/**
 * Run a read on the same chain so it observes only committed state. SqliteStore's
 * depth-guarded transaction would otherwise let a read started mid-write join the
 * open write and capture uncommitted (or to-be-rolled-back) rows — exactly what a
 * pre-destructive safety snapshot must never do.
 */
export function serializeRead<T>(fn: () => Promise<T>): Promise<T> {
  return serialize(fn)
}

export function runUndo(): Promise<void> {
  return serialize(() => undo())
}

export function runRedo(): Promise<void> {
  return serialize(() => redo())
}

export function ensureVocab(table: 'kind' | 'relationType', name: string): Promise<{ id: string }> {
  return serialize(async () => ({
    id: table === 'kind' ? await ensureKind(name) : await ensureRelationType(name),
  }))
}

export function undoState(): { canUndo: boolean; canRedo: boolean } {
  return { canUndo: canUndo(), canRedo: canRedo() }
}
