# Architecture overview

gnosis-graphs is a single-user, self-hosted knowledge-graph tool. One Node
process serves the built React SPA, a JSON-over-HTTP data API, and a
Server-Sent-Events (SSE) reactivity stream — all from the same origin. State
lives in SQLite (`node:sqlite`, built into Node 24) and is projected to the host
filesystem as bundle snapshots and a read-only file mirror.

## The 10,000-ft picture

```
┌────────────────────────────────────────────────────────────────┐
│  Browser (React 19 SPA)                                         │
│    UI  →  src/data/client.ts  ──HTTP──▶  POST /api/command      │
│        ◀──SSE── /api/events  (StoreEvent[] + canUndo/canRedo)   │
└────────────────────────────────────────────────────────────────┘
                          │ same origin
┌────────────────────────────────────────────────────────────────┐
│  Node server (Hono on @hono/node-server)                        │
│    server/api.ts      routes + SSE fan-out                      │
│    server/registry.ts FACTORIES + serialized write chain       │
│    src/data/commands  Command pattern (do / undo, StoreEvent[]) │
│    src/data/store     SqliteStore (GnosisDB seam)               │
│         │                                                       │
│         ├─▶ server/snapshots.ts   → ./snapshots/*.json          │
│         └─▶ server/files-mirror.ts → ./files/<slug>-<id>.<ext>  │
└────────────────────────────────────────────────────────────────┘
                          │
                    SQLite file (GNOSIS_DB)
```

The command layer (`src/data/commands`) is the heart: every mutation is a
`Command` with `do`/`undo` methods that return a list of `StoreEvent`s. The
server wraps each command in a SQLite transaction, pushes it onto an undo stack,
and broadcasts its events to every connected client. The client turns those
events into cache invalidations, which trigger re-fetches and re-renders.

## Boot sequence

`server/main.ts` runs once at process start:

1. `dbFile = process.env.GNOSIS_DB ?? ':memory:'`; `port = Number(process.env.PORT ?? 8787)`.
2. If `dbFile !== ':memory:'`, `mkdirSync(dirname(dbFile), { recursive: true })`.
3. `const store = new SqliteStore(dbFile)`; cast to `GnosisDB`; `setDbOverride(db)` so the existing command layer's `getDb()` targets SQLite.
4. `await seedWorkspace(db)` — ensure a baseline workspace exists (seeded kinds, relation types, the root graph, and Home).
5. If `(getMeta('schemaVersion') ?? 0) < 3`, run `await migrateLiveToV3(db)` then `setMeta('schemaVersion', SCHEMA_VERSION)` — fold v2 inline payloads into file/link references **before** the search index reads file content.
6. `await buildSearchIndex()` — build MiniSearch from the current DB.
7. `onCommand(applyCommandEvent)` — keep the search index maintained from command events.
8. `startSnapshots()` — register an `onCommand` listener (marks dirty; `snapshotTick` immediately on `event.cascade`) plus a 5-minute `setInterval`.
9. `startFileMirror()` — run an initial `reconcile()` and register an `onCommand` listener (debounced reconcile on `files-changed`).
10. `serve({ fetch: app.fetch, port })` — Hono on `@hono/node-server`; logs `gnosis server listening on http://localhost:PORT (db: ...)`.

## Request lifecycle

A UI mutation travels one path and comes back as a broadcast:

```
UI action
  └─▶ runCommand(kind, args)            src/data/client.ts
        └─▶ POST /api/command           server/api.ts
              └─▶ runCommand            server/registry.ts (serialized chain)
                    └─▶ FACTORIES[kind] build the Command
                          └─▶ dispatch  src/data/commands/dispatcher.ts
                                └─▶ db.transaction → command.do(db)
                                      └─▶ returns StoreEvent[]
                                            └─▶ emitCommand(CommandEvent)
  ◀── 200 { ok:true, ...result }        (minted ids: nodeId/edgeId/…)

emitCommand fans out to:
  • applyCommandEvent  → search index maintenance
  • snapshots listener → mark dirty / snapshot on cascade
  • file-mirror listener → debounced reconcile on files-changed
  • SSE clients        → JSON.stringify(CommandEvent + canUndo/canRedo)
        └─▶ EventSource onmessage      src/data/client.ts connectEvents
              └─▶ applyEvents(events)   invalidate keyed query cache
                    └─▶ re-fetch + re-render the affected views
```

**Undo/redo reverses this.** `POST /api/undo` pops the undo stack and runs the
command's `undo(db)` inside a transaction, which emits the inverse
`StoreEvent[]`. The same SSE fan-out carries those events to the client, so every
connected tab converges. The response also carries fresh `canUndo`/`canRedo`
flags, which feed the client's `useUndoRedo()` store. Redo replays the command's
`do` from the redo stack.

The DSL apply path (`POST /api/graph/:id/source`) is the one exception that
builds a *composite* command (see [DSL engine](./dsl-engine)) and dispatches it
through the same serialized chain as a single undo step.

## Directory map

| Path | Responsibility |
| --- | --- |
| `server/main.ts` | Process entry: build the store, seed, migrate, wire listeners, listen. |
| `server/api.ts` | Hono app: every `/api/*` route, the SSE fan-out, the static/SPA fallback. |
| `server/registry.ts` | `FACTORIES` (kind → command), the serialized write chain, `dispatchComposite`, undo/redo entry points. |
| `server/graphSource.ts` | `buildApplyCommand` — a DSL apply as one composite, re-runnable command. |
| `server/snapshots.ts` | Periodic + cascade-triggered full-bundle snapshots, pruned to `KEEP`. |
| `server/files-mirror.ts` | One-way DB → filesystem projection of the `files` table. |
| `server/migrateLive.ts` | Live v2→v3 payload-fold on a pre-Phase-1 database. |
| `src/data/commands/` | The `Command` pattern: per-domain factories, the dual-stack dispatcher, integrity guards. |
| `src/data/store/sqliteStore.ts` | `SqliteStore` — the synchronous SQLite backing implementing the `GnosisDB` surface. |
| `src/data/db.ts` | The `GnosisDB` interface + `getDb()` / `setDbOverride()` seam. |
| `src/data/queries.ts` | Read helpers (`placementsByGraph`, `appearsIn`, `looseEnds`, usage counts). |
| `src/data/bundle/` | Export, import, validation, and the versioned migration ladder. |
| `src/data/source/` | DSL parse / plan / serialize / layout. |
| `src/data/search/` | MiniSearch index build + incremental maintenance. |
| `src/data/client.ts` | The browser data seam: HTTP reads/commands + SSE reactivity + React hooks. |
| `src/data/react/contentStore.ts` | Zustand store for the vocab/graph snapshot (nodes, kinds, relation types, graphs). |
| `src/` (App, canvas, panel, picker, …) | The React UI — presentational, driven entirely by `client.ts`. |

## The replatform story

gnosis-graphs began as a fully browser-local app: data lived in IndexedDB
(Dexie) with `liveQuery` reactivity and an in-process dispatcher. The current
design moves the store, command layer, and reactivity onto a self-hosted Node
server backed by SQLite — the browser keeps the same command vocabulary and UI,
but every read, write, and event now crosses an HTTP/SSE seam. The original
browser-local design is preserved verbatim at
[project-spec v1](/history/project-spec-v1) for reference; everything in these
architecture pages describes the server-backed system as it stands today.
