import type {
  EdgeRecord,
  FileRecord,
  GraphRecord,
  KindRecord,
  MetaRow,
  NodeRecord,
  PlacementRecord,
  RelationTypeRecord,
} from './types'

/**
 * The table surface the command layer / queries / bundle / integrity use,
 * satisfied by the synchronous SQLite Store (src/data/store/sqliteStore.ts).
 * Dexie is gone: SQLite is the only store, set via setDbOverride on the
 * server and in tests.
 */
interface Collection<T> {
  filter(fn: (row: T) => boolean): Collection<T>
  toArray(): Promise<T[]>
  first(): Promise<T | undefined>
  count(): Promise<number>
}

interface WhereClause<T> {
  equals(value: unknown): Collection<T>
  anyOf(values: unknown[]): Collection<T>
}

interface OrderedCollection {
  uniqueKeys(): Promise<unknown[]>
}

export interface Table<T, K = string> {
  get(id: K | Partial<T>): Promise<T | undefined>
  add(row: T): Promise<void>
  put(row: T): Promise<void>
  delete(id: K): Promise<void>
  bulkGet(ids: K[]): Promise<(T | undefined)[]>
  bulkAdd(rows: T[]): Promise<void>
  bulkPut(rows: T[]): Promise<void>
  bulkDelete(ids: K[]): Promise<void>
  clear(): Promise<void>
  toArray(): Promise<T[]>
  count(): Promise<number>
  toCollection(): Collection<T>
  filter(fn: (row: T) => boolean): Collection<T>
  where(col: string): WhereClause<T>
  orderBy(col: string): OrderedCollection
}

export interface GnosisDB {
  nodes: Table<NodeRecord>
  files: Table<FileRecord>
  graphs: Table<GraphRecord>
  placements: Table<PlacementRecord>
  edges: Table<EdgeRecord>
  relationTypes: Table<RelationTypeRecord>
  kinds: Table<KindRecord>
  meta: Table<MetaRow>
  tables: Table<unknown>[]
  transaction<T>(fn: () => T | Promise<T>): Promise<T>
}

let override: GnosisDB | null = null

/**
 * The store seam: the server and tests build a SqliteStore and route the
 * command layer at it through this override.
 */
export function setDbOverride(db: GnosisDB | null): void {
  override = db
}

export function getDb(): GnosisDB {
  if (!override) throw new Error('No database configured — call setDbOverride first')
  return override
}

export async function getMeta<T>(db: GnosisDB, key: string): Promise<T | undefined> {
  const row = await db.meta.get(key)
  return row?.value as T | undefined
}

export async function setMeta(db: GnosisDB, key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}
