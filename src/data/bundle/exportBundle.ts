import { getDb, getMeta } from '../db'
import type { WorkspaceBundle } from '../types'
import { SCHEMA_VERSION } from './migrate'

/** Lossless workspace snapshot (§9), read in a single transaction. */
export async function exportBundle(): Promise<WorkspaceBundle> {
  const db = getDb()
  return db.transaction(async () => {
    const [nodes, files, graphs, placements, edges, relationTypes, kinds, rootGraphId, homeGraphId] =
      await Promise.all([
        db.nodes.toArray(),
        db.files.toArray(),
        db.graphs.toArray(),
        db.placements.toArray(),
        db.edges.toArray(),
        db.relationTypes.toArray(),
        db.kinds.toArray(),
        getMeta<string>(db, 'rootGraphId'),
        getMeta<string>(db, 'homeGraphId'),
      ])
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      nodes,
      graphs,
      placements,
      edges,
      relationTypes,
      kinds,
      files,
      meta: { rootGraphId: rootGraphId ?? null, homeGraphId: homeGraphId ?? null },
    }
  })
}
