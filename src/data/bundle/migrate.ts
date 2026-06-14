import { extFor } from '../files/extFor'
import { slug } from '../files/slug'
import type { FileRecord, NodeRecord, WorkspaceBundle } from '../types'
import { migratePayloadV2 } from './transforms'

/** The current workspace data schema (v3: inline payloads become file/link references). */
export const SCHEMA_VERSION = 3

export class BundleTooNewError extends Error {}

interface MigrationStep {
  to: number
  transform: (bundle: WorkspaceBundle) => WorkspaceBundle
}

/** A v2 node still carries the inline `{ format, content, language? }` payload. */
interface NodeV2 extends Omit<NodeRecord, 'payload'> {
  payload: { format: 'markdown' | 'plaintext' | 'code' | 'link'; content: string; language?: string }
}

/**
 * v2 → v3 for one node: a 'link' payload becomes a link reference; non-empty
 * content mints a FileRecord (filename from the slug + detected extension) and a
 * file reference; empty content drops the payload entirely. extFor is used (NOT
 * detectFormat) so this stays off the language-data import graph.
 */
export function migrateNodeToV3(
  node: NodeV2,
  now: number,
): { node: NodeRecord; file?: FileRecord } {
  const { payload, ...rest } = node
  if (payload.format === 'link') {
    return { node: { ...rest, payload: { kind: 'link', url: payload.content } } }
  }
  if (payload.content === '') {
    const bare = { ...rest } as NodeRecord
    delete bare.payload
    return { node: bare }
  }
  const format = payload.format
  const fileId = crypto.randomUUID()
  const file: FileRecord = {
    id: fileId,
    nodeId: node.id,
    filename: `${slug(node.title)}.${extFor(format, payload.language)}`,
    format,
    ...(payload.language ? { language: payload.language } : {}),
    content: payload.content,
    createdAt: now,
    updatedAt: now,
  }
  return { node: { ...rest, payload: { kind: 'file', fileId } }, file }
}

/** Stepwise pure transforms; the step with `to: N` upgrades a v(N-1) bundle to vN. */
const steps: MigrationStep[] = [
  {
    to: 2,
    transform: (bundle) => ({
      ...bundle,
      nodes: bundle.nodes.map((node) => {
        const payload = (node as unknown as NodeV2).payload
        return payload ? { ...node, payload: migratePayloadV2(payload) } : node
      }) as unknown as NodeRecord[],
    }),
  },
  {
    to: 3,
    transform: (bundle) => {
      const now = Date.now()
      const files: FileRecord[] = [...(bundle.files ?? [])]
      const nodes = bundle.nodes.map((node) => {
        // A payload-less node (e.g. the Home pointer) already speaks v3.
        if (!(node as unknown as NodeV2).payload) return node
        const migrated = migrateNodeToV3(node as unknown as NodeV2, now)
        if (migrated.file) files.push(migrated.file)
        return migrated.node
      })
      return { ...bundle, nodes, files }
    },
  },
]

export function migrateBundle(bundle: WorkspaceBundle): WorkspaceBundle {
  if (bundle.schemaVersion > SCHEMA_VERSION) {
    throw new BundleTooNewError(
      `Bundle uses schema v${bundle.schemaVersion}, but this app only knows v${SCHEMA_VERSION}. ` +
        'Update the app, then import again — nothing was changed.',
    )
  }
  let migrated = bundle
  for (const step of steps) {
    if (migrated.schemaVersion < step.to) {
      migrated = { ...step.transform(migrated), schemaVersion: step.to }
    }
  }
  return migrated
}
