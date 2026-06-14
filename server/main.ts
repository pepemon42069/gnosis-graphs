/// <reference types="node" />
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { serve } from '@hono/node-server'
import { SCHEMA_VERSION } from '../src/data/bundle/migrate'
import { getMeta, setDbOverride, setMeta, type GnosisDB } from '../src/data/db'
import { onCommand } from '../src/data/events'
import { migrateLiveToV3 } from './migrateLive'
import { seedWorkspace } from '../src/data/seed'
import { applyCommandEvent, buildSearchIndex } from '../src/data/search/searchIndex'
import { SqliteStore } from '../src/data/store/sqliteStore'
import { app } from './api'
import { startFileMirror } from './files-mirror'
import { startSnapshots } from './snapshots'

/**
 * The self-hosted server: one SQLite-backed Store drives the existing command
 * layer (via the getDb override), MiniSearch is rebuilt + maintained from
 * command events, and Hono serves the API + SSE. ':memory:' by default; set
 * GNOSIS_DB to a file path for persistence.
 */
const dbFile = process.env.GNOSIS_DB ?? ':memory:'
const port = Number(process.env.PORT ?? 8787)

if (dbFile !== ':memory:') mkdirSync(dirname(dbFile), { recursive: true })
const store = new SqliteStore(dbFile)
const db = store as unknown as GnosisDB
setDbOverride(db)
await seedWorkspace(db)
// Live v2→v3: fold inline node payloads into file/link references on a DB that
// predates Phase 1, before the search index reads file content.
if (((await getMeta<number>(db, 'schemaVersion')) ?? 0) < 3) {
  await migrateLiveToV3(db)
  await setMeta(db, 'schemaVersion', SCHEMA_VERSION)
}
await buildSearchIndex()
onCommand(applyCommandEvent)
startSnapshots()
startFileMirror()

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`gnosis server listening on http://localhost:${info.port} (db: ${dbFile})`)
})
