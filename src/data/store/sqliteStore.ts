/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite'

/**
 * A synchronous-SQLite backing for the command layer that mimics exactly the
 * Dexie surface the commands/queries/seed use (re-platform plan). Rows are
 * stored as a JSON `doc` plus extracted indexed columns; reads return parsed
 * records. Mutating methods are async so a thrown constraint error surfaces as a
 * rejected promise (Dexie's contract) while the write still runs synchronously
 * inside the surrounding transaction.
 *
 * The transaction wrapper accepts the command's async do/undo and brackets its
 * synchronous DB ops in BEGIN/COMMIT, joining nested calls so seed/import
 * (which open their own transaction) compose. Serialised, single-connection,
 * single-user: no two transactions interleave.
 */

type AnyRow = Record<string, unknown>
type Pred = (row: AnyRow) => boolean

interface TableSpec {
  pk: string
  /** Secondary indexed columns (Dexie `.where(col)` targets). */
  cols: string[]
  /** Unique compound indexes, e.g. placements [graphId+nodeId]. */
  unique?: string[][]
}

const SPECS: Record<string, TableSpec> = {
  nodes: { pk: 'id', cols: ['childGraphId'] },
  files: { pk: 'id', cols: ['nodeId'] },
  graphs: { pk: 'id', cols: [] },
  placements: { pk: 'id', cols: ['graphId', 'nodeId'], unique: [['graphId', 'nodeId']] },
  edges: { pk: 'id', cols: ['graphId', 'fromNodeId', 'toNodeId', 'relationTypeId'] },
  relationTypes: { pk: 'id', cols: [] },
  kinds: { pk: 'id', cols: [] },
  meta: { pk: 'key', cols: [] },
}

class Collection {
  private readonly table: Table
  private readonly sql: string
  private readonly params: unknown[]
  private readonly preds: Pred[]

  constructor(table: Table, sql: string, params: unknown[], preds: Pred[] = []) {
    this.table = table
    this.sql = sql
    this.params = params
    this.preds = preds
  }

  filter(fn: Pred): Collection {
    return new Collection(this.table, this.sql, this.params, [...this.preds, fn])
  }

  private rows(): AnyRow[] {
    const rows = this.table.rawQuery(this.sql, this.params)
    return this.preds.length ? rows.filter((r) => this.preds.every((p) => p(r))) : rows
  }

  async toArray(): Promise<AnyRow[]> {
    return this.rows()
  }

  async first(): Promise<AnyRow | undefined> {
    return this.rows()[0]
  }

  async count(): Promise<number> {
    return this.rows().length
  }

}

class WhereClause {
  private readonly table: Table
  private readonly col: string

  constructor(table: Table, col: string) {
    this.table = table
    this.col = col
  }

  equals(value: unknown): Collection {
    return new Collection(this.table, `WHERE ${this.col} = ?`, [value])
  }

  anyOf(values: unknown[]): Collection {
    if (!values.length) return new Collection(this.table, 'WHERE 0', [])
    const holes = values.map(() => '?').join(',')
    return new Collection(this.table, `WHERE ${this.col} IN (${holes})`, values)
  }
}

class OrderedCollection {
  private readonly table: Table
  private readonly col: string

  constructor(table: Table, col: string) {
    this.table = table
    this.col = col
  }

  async uniqueKeys(): Promise<unknown[]> {
    const rows = this.table.rawSelect(`SELECT DISTINCT ${this.col} AS k FROM ${this.table.name}`)
    return rows.map((r) => (r as { k: unknown }).k).filter((k) => k !== null)
  }
}

class Table {
  readonly name: string
  private readonly db: DatabaseSync
  private readonly spec: TableSpec

  constructor(name: string, db: DatabaseSync, spec: TableSpec) {
    this.name = name
    this.db = db
    this.spec = spec
  }

  private columns(): string[] {
    return [this.spec.pk, ...this.spec.cols, 'doc']
  }

  private serialize(row: AnyRow): unknown[] {
    return [
      row[this.spec.pk],
      ...this.spec.cols.map((c) => (row[c] ?? null) as unknown),
      JSON.stringify(row),
    ]
  }

  /** Synchronous write; the async public wrappers turn a thrown constraint
   * error into a rejected promise, matching Dexie (commands `await` these). */
  putSync(row: AnyRow, replace = true): void {
    const c = this.columns()
    const placeholders = c.map(() => '?').join(',')
    const values = this.serialize(row) as never[]
    if (!replace) {
      this.db.prepare(`INSERT INTO ${this.name} (${c.join(',')}) VALUES (${placeholders})`).run(...values)
      return
    }
    // Upsert conflicting ONLY on the primary key: a secondary unique-index
    // violation (e.g. placements' unique graphId+nodeId) then raises a constraint
    // error like Dexie's put(), instead of OR REPLACE silently deleting the row.
    const set = [...this.spec.cols, 'doc'].map((col) => `${col}=excluded.${col}`).join(',')
    this.db
      .prepare(
        `INSERT INTO ${this.name} (${c.join(',')}) VALUES (${placeholders}) ` +
          `ON CONFLICT(${this.spec.pk}) DO UPDATE SET ${set}`,
      )
      .run(...values)
  }

  private deleteSync(id: unknown): void {
    this.db.prepare(`DELETE FROM ${this.name} WHERE ${this.spec.pk} = ?`).run(id as never)
  }

  rawQuery(suffix: string, params: unknown[]): AnyRow[] {
    const rows = this.db.prepare(`SELECT doc FROM ${this.name} ${suffix}`).all(...(params as never[]))
    return rows.map((r) => JSON.parse((r as { doc: string }).doc) as AnyRow)
  }

  rawSelect(sql: string): unknown[] {
    return this.db.prepare(sql).all()
  }

  async get(id: unknown): Promise<AnyRow | undefined> {
    return this.getSync(id)
  }

  private getSync(id: unknown): AnyRow | undefined {
    // Dexie compound-key lookup, e.g. placements.get({ graphId, nodeId }).
    if (id !== null && typeof id === 'object') {
      const entries = Object.entries(id as Record<string, unknown>)
      const where = entries.map(([k]) => `${k} = ?`).join(' AND ')
      const row = this.db
        .prepare(`SELECT doc FROM ${this.name} WHERE ${where} LIMIT 1`)
        .get(...(entries.map(([, v]) => v) as never[])) as { doc: string } | undefined
      return row ? (JSON.parse(row.doc) as AnyRow) : undefined
    }
    const row = this.db
      .prepare(`SELECT doc FROM ${this.name} WHERE ${this.spec.pk} = ?`)
      .get(id as never) as { doc: string } | undefined
    return row ? (JSON.parse(row.doc) as AnyRow) : undefined
  }

  async add(row: AnyRow): Promise<void> {
    this.putSync(row, false)
  }

  async put(row: AnyRow): Promise<void> {
    this.putSync(row, true)
  }

  async delete(id: unknown): Promise<void> {
    this.deleteSync(id)
  }

  async bulkGet(ids: unknown[]): Promise<(AnyRow | undefined)[]> {
    return ids.map((id) => this.getSync(id))
  }

  async bulkAdd(rows: AnyRow[]): Promise<void> {
    for (const r of rows) this.putSync(r, false)
  }

  async bulkPut(rows: AnyRow[]): Promise<void> {
    for (const r of rows) this.putSync(r, true)
  }

  async bulkDelete(ids: unknown[]): Promise<void> {
    for (const id of ids) this.deleteSync(id)
  }

  async clear(): Promise<void> {
    this.db.prepare(`DELETE FROM ${this.name}`).run()
  }

  async toArray(): Promise<AnyRow[]> {
    return this.rawQuery('', [])
  }

  async count(): Promise<number> {
    const row = this.db.prepare(`SELECT count(*) AS c FROM ${this.name}`).get() as { c: number }
    return row.c
  }

  toCollection(): Collection {
    return new Collection(this, '', [])
  }

  filter(fn: Pred): Collection {
    return this.toCollection().filter(fn)
  }

  where(col: string): WhereClause {
    return new WhereClause(this, col)
  }

  orderBy(col: string): OrderedCollection {
    return new OrderedCollection(this, col)
  }
}

export class SqliteStore {
  readonly raw: DatabaseSync
  readonly nodes: Table
  readonly files: Table
  readonly graphs: Table
  readonly placements: Table
  readonly edges: Table
  readonly relationTypes: Table
  readonly kinds: Table
  readonly meta: Table
  readonly tables: Table[]
  private depth = 0

  constructor(filename = ':memory:') {
    this.raw = new DatabaseSync(filename)
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;')
    for (const [name, spec] of Object.entries(SPECS)) this.createTable(name, spec)
    const table = (name: keyof typeof SPECS) => new Table(name, this.raw, SPECS[name] as TableSpec)
    this.nodes = table('nodes')
    this.files = table('files')
    this.graphs = table('graphs')
    this.placements = table('placements')
    this.edges = table('edges')
    this.relationTypes = table('relationTypes')
    this.kinds = table('kinds')
    this.meta = table('meta')
    this.tables = [
      this.nodes,
      this.files,
      this.graphs,
      this.placements,
      this.edges,
      this.relationTypes,
      this.kinds,
      this.meta,
    ]
  }

  private createTable(name: string, spec: TableSpec): void {
    const cols = [
      `${spec.pk} TEXT PRIMARY KEY`,
      ...spec.cols.map((c) => `${c} TEXT`),
      'doc TEXT NOT NULL',
    ]
    this.raw.exec(`CREATE TABLE IF NOT EXISTS ${name} (${cols.join(', ')})`)
    for (const c of spec.cols) {
      this.raw.exec(`CREATE INDEX IF NOT EXISTS ${name}_${c} ON ${name}(${c})`)
    }
    for (const u of spec.unique ?? []) {
      this.raw.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${name}_${u.join('_')} ON ${name}(${u.join(',')})`,
      )
    }
  }

  /** Depth-guarded so nested (seed/import) transactions join the outer one. */
  async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this.depth > 0) return await fn()
    this.depth++
    this.raw.exec('BEGIN')
    try {
      const result = await fn()
      this.raw.exec('COMMIT')
      return result
    } catch (err) {
      this.raw.exec('ROLLBACK')
      throw err
    } finally {
      this.depth--
    }
  }

  close(): void {
    this.raw.close()
  }
}
