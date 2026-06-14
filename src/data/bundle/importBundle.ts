import { clearHistory } from '../commands/dispatcher'
import { getDb } from '../db'
import { emitCommand } from '../events'
import { seedWorkspace } from '../seed'
import type { MetaRow, WorkspaceBundle } from '../types'
import { migrateBundle, SCHEMA_VERSION } from './migrate'

export class InvalidBundleError extends Error {}

const RECORD_KEYS = ['nodes', 'graphs', 'placements', 'edges', 'relationTypes', 'kinds'] as const

function fail(message: string): never {
  throw new InvalidBundleError(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function validateBundle(raw: unknown): WorkspaceBundle {
  if (!isRecord(raw)) fail('bundle: expected a JSON object')
  if (typeof raw.schemaVersion !== 'number') fail('schemaVersion: expected a number')
  if (typeof raw.exportedAt !== 'string') fail('exportedAt: expected a string')
  for (const key of RECORD_KEYS) {
    const rows = raw[key]
    if (!Array.isArray(rows)) fail(`${key}: expected an array`)
    for (const row of rows) {
      if (!isRecord(row) || typeof row.id !== 'string') fail(`${key}: record without a string id`)
    }
  }
  // files is required at v3, but pre-Phase-1 bundles omit it; migrateBundle's
  // to:3 step fills it. Validate only when present (a v2 bundle's file refs are
  // minted during migrate, after this check).
  if (raw.files !== undefined) {
    if (!Array.isArray(raw.files)) fail('files: expected an array')
    for (const row of raw.files) {
      if (!isRecord(row) || typeof row.id !== 'string') fail('files: record without a string id')
    }
  }
  if (!isRecord(raw.meta)) fail('meta: expected an object')
  for (const key of ['rootGraphId', 'homeGraphId'] as const) {
    const value = raw.meta[key]
    if (value !== null && typeof value !== 'string') fail(`meta.${key}: expected string or null`)
  }
  const bundle = raw as unknown as WorkspaceBundle
  assertBundleIntegrity(bundle)
  return bundle
}

/**
 * §3's forbidden bug class, enforced at the import door: a bundle with zero
 * graphs would brick boot, and dangling references would embed permanently
 * (IndexedDB has no foreign keys). Pure checks — nothing is touched on failure.
 */
function assertBundleIntegrity(bundle: WorkspaceBundle): void {
  if (bundle.graphs.length === 0) fail('graphs: a workspace bundle must contain at least one graph')
  const graphIds = new Set(bundle.graphs.map((g) => g.id))
  const nodeIds = new Set(bundle.nodes.map((n) => n.id))
  const relationTypeIds = new Set(bundle.relationTypes.map((t) => t.id))
  const kindIds = new Set(bundle.kinds.map((k) => k.id))
  for (const p of bundle.placements) {
    if (!graphIds.has(p.graphId)) fail(`placements: ${p.id} references missing graph ${p.graphId}`)
    if (!nodeIds.has(p.nodeId)) fail(`placements: ${p.id} references missing node ${p.nodeId}`)
  }
  for (const e of bundle.edges) {
    if (!graphIds.has(e.graphId)) fail(`edges: ${e.id} references missing graph ${e.graphId}`)
    if (!nodeIds.has(e.fromNodeId)) fail(`edges: ${e.id} references missing node ${e.fromNodeId}`)
    if (!nodeIds.has(e.toNodeId)) fail(`edges: ${e.id} references missing node ${e.toNodeId}`)
    if (!relationTypeIds.has(e.relationTypeId)) {
      fail(`edges: ${e.id} references missing relation type ${e.relationTypeId}`)
    }
  }
  // files is undefined on un-migrated v2 bundles; integrity over the references
  // only bites once migrateBundle's to:3 step has filled the table.
  const files = bundle.files ?? []
  const fileIds = new Set(files.map((f) => f.id))
  for (const f of files) {
    if (!nodeIds.has(f.nodeId)) fail(`files: ${f.id} references missing node ${f.nodeId}`)
  }
  for (const n of bundle.nodes) {
    if (n.kindId && !kindIds.has(n.kindId)) {
      fail(`nodes: ${n.id} references missing kind ${n.kindId}`)
    }
    if (n.childGraphId && !graphIds.has(n.childGraphId)) {
      fail(`nodes: ${n.id} references missing child graph ${n.childGraphId}`)
    }
    if (n.payload?.kind === 'file' && !fileIds.has(n.payload.fileId)) {
      fail(`nodes: ${n.id} references missing file ${n.payload.fileId}`)
    }
  }
  for (const key of ['rootGraphId', 'homeGraphId'] as const) {
    const id = bundle.meta[key]
    if (id !== null && !graphIds.has(id)) fail(`meta.${key}: references missing graph ${id}`)
  }
}

/**
 * Full workspace replace (§9). Caller owns the confirmation dialog; this
 * assumes consent.
 */
export async function importBundle(raw: unknown): Promise<void> {
  const bundle = migrateBundle(validateBundle(raw))
  // §9: the pre-replace safety snapshot is the server's job now — the
  // /api/import route writes one (and refuses on failure) before calling this.
  const db = getDb()
  await db.transaction(async () => {
    // §8: the mirror directory handle is environment config, not workspace
    // data — it survives the replace.
    const mirrorRow = await db.meta.get('mirrorDirHandle')
    await Promise.all(db.tables.map((table) => table.clear()))
    await db.nodes.bulkAdd(bundle.nodes)
    await db.files.bulkAdd(bundle.files ?? [])
    await db.graphs.bulkAdd(bundle.graphs)
    await db.placements.bulkAdd(bundle.placements)
    await db.edges.bulkAdd(bundle.edges)
    await db.relationTypes.bulkAdd(bundle.relationTypes)
    await db.kinds.bulkAdd(bundle.kinds)
    const metaRows: MetaRow[] = [
      { key: 'schemaVersion', value: SCHEMA_VERSION },
      // The seed steps the bundle's content embodies: step 1 (vocab + root)
      // always, step 2 only when it carries Home — a lower pin lets
      // seedWorkspace heal the missing step instead of suppressing it forever.
      { key: 'seedVersion', value: bundle.meta.homeGraphId !== null ? 2 : 1 },
      ...(mirrorRow ? [mirrorRow] : []),
    ]
    if (bundle.meta.rootGraphId !== null) {
      metaRows.push({ key: 'rootGraphId', value: bundle.meta.rootGraphId })
    }
    if (bundle.meta.homeGraphId !== null) {
      metaRows.push({ key: 'homeGraphId', value: bundle.meta.homeGraphId })
    }
    await db.meta.bulkAdd(metaRows)
  })
  // Pre-Home bundles (v0.1 exports, old snapshots): create Home now, in-session.
  await seedWorkspace(db)
  clearHistory()
  emitCommand({
    label: 'import-workspace',
    transient: false,
    cascade: true,
    events: [{ type: 'workspace-replaced' }],
  })
}

export async function readBundleFile(file: File): Promise<unknown> {
  const text = await file.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new InvalidBundleError(`${file.name}: not valid JSON`)
  }
}
