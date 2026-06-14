import { migrateNodeToV3 } from '../src/data/bundle/migrate'
import type { GnosisDB } from '../src/data/db'
import type { FileRecord } from '../src/data/types'

/**
 * Live v2→v3: rewrites every node's inline payload into a file/link reference
 * inside one transaction, reusing the same migrateNodeToV3 helper the bundle
 * migration uses. Nodes whose payload is already a reference (kind file/link) or
 * absent are left untouched, so this is safe to skip-guard on meta.schemaVersion.
 */
export async function migrateLiveToV3(db: GnosisDB): Promise<void> {
  await db.transaction(async () => {
    const nodes = await db.nodes.toArray()
    const now = Date.now()
    const files: FileRecord[] = []
    for (const node of nodes) {
      const payload = node.payload as { kind?: string; format?: string } | undefined
      if (!payload || payload.kind === 'file' || payload.kind === 'link') continue
      const migrated = migrateNodeToV3(node as never, now)
      await db.nodes.put(migrated.node)
      if (migrated.file) files.push(migrated.file)
    }
    if (files.length) await db.files.bulkAdd(files)
  })
}
