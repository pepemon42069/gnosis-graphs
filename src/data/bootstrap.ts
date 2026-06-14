import { getDb, getMeta } from './db'

/** Home (v0.2) → root → any existing graph; verified against the graphs table. */
export async function resolveInitialGraphId(): Promise<string | null> {
  const db = getDb()
  const candidates = [
    await getMeta<string>(db, 'homeGraphId'),
    await getMeta<string>(db, 'rootGraphId'),
  ]
  for (const id of candidates) {
    if (id && (await db.graphs.get(id))) return id
  }
  return (await db.graphs.toCollection().first())?.id ?? null
}
