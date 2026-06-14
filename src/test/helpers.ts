/// <reference types="node" />
import { clearHistory } from '../data/commands/dispatcher'
import { type GnosisDB, setDbOverride } from '../data/db'
import { seedWorkspace } from '../data/seed'
import { SqliteStore } from '../data/store/sqliteStore'

let currentStore: SqliteStore | null = null

/** Fully isolated workspace per test: fresh in-memory SQLite store, seeded. */
export async function freshDb(): Promise<GnosisDB> {
  clearHistory()
  currentStore?.close()
  const store = new SqliteStore()
  currentStore = store
  const db = store as unknown as GnosisDB
  setDbOverride(db)
  await seedWorkspace(db)
  return db
}

export interface WorkspaceDump {
  nodes: unknown[]
  files: unknown[]
  graphs: unknown[]
  placements: unknown[]
  edges: unknown[]
  relationTypes: unknown[]
  kinds: unknown[]
  meta: unknown[]
}

/** Stable full-workspace snapshot for deep-equal restoration checks. */
export async function dumpAll(db: GnosisDB): Promise<WorkspaceDump> {
  const byId = <T extends { id: string }>(rows: T[]) =>
    [...rows].sort((a, b) => a.id.localeCompare(b.id))
  return {
    nodes: byId(await db.nodes.toArray()),
    files: byId(await db.files.toArray()),
    graphs: byId(await db.graphs.toArray()),
    placements: byId(await db.placements.toArray()),
    edges: byId(await db.edges.toArray()),
    relationTypes: byId(await db.relationTypes.toArray()),
    kinds: byId(await db.kinds.toArray()),
    meta: (await db.meta.toArray()).sort((a, b) => a.key.localeCompare(b.key)),
  }
}
