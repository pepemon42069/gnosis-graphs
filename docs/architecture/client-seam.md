# The client data seam

`src/data/client.ts` is the single boundary between the React UI and the server.
There is no in-browser database, no Dexie, no `liveQuery`. Reads and commands go
out over HTTP; reactivity comes back over a single SSE stream. The UI never
fetches directly — it consumes hooks and one-shot functions exported from this
module.

```
React components
   │  hooks (useGraphData, useFile, …)       one-shots (runCommand, fetchExport, …)
   ▼                                          ▼
keyed query cache  ◀── invalidate ──  applyEvents  ◀── SSE /api/events
   │                                          ▲
   ▼ load() on miss / invalidate              │ EventSource (auto-reconnect)
fetch GET /api/…                              │
                                       POST /api/command, /undo, /redo, …
```

## HTTP: reads and commands

Two thin helpers wrap `fetch` against the `/api` origin (same-origin in
production; Vite proxies `/api` in dev):

- `apiGet<T>(path)` — `GET`, throws on non-OK.
- `apiPost<T>(path, body)` — `POST` JSON; on non-OK it reads `{ error }` from the
  body and throws that message (so server-side command failures surface a useful
  string).

### Commands

```ts
runCommand(kind, args)  →  POST /api/command  →  result (minted ids)
runUndo()               →  POST /api/undo
runRedo()               →  POST /api/redo
ensureVocab(table, name) → POST /api/ensure/<table> → id
```

`runCommand` returns just the `result` record (e.g. `{ nodeId }`), so callers
get the minted id back synchronously after the round-trip.

### One-shot fetches

`fetchMeta`, `fetchUsage`, `searchWorkspace`, `fetchExport`, `importBundle`,
`fetchFile`, `fetchGraphSource`, `applyGraphSource`, `fetchAppearsIn`,
`fetchGraphData`, and `refreshVocab`. These are imperative — used by event
handlers, the source editor, the settings/Data tab, etc.

`applyGraphSource` is special: **parse errors come back as a `400` body, not a
thrown error.** The caller branches on the returned `ok` flag to surface
line-numbered messages in the editor rather than treating them as a network
failure.

## The keyed query cache

Hooks share one in-module cache keyed by string. Three maps back it:

```ts
const cache    = new Map<string, unknown>()        // key → last value
const fetchers = new Map<string, () => Promise<unknown>>()  // key → loader
const subs     = new Map<string, Set<() => void>>()         // key → subscribers
```

`useApiQuery(key, fetcher, fallback)` registers the fetcher, subscribes via
`useSyncExternalStore`, and triggers a `load(key)` on first subscribe (cache
miss). `load` runs the fetcher, stores the result, and notifies subscribers;
failures are swallowed (an SSE event or remount retries).

Invalidation has a deliberate subtlety:

```ts
function invalidate(key) {
  // A key with live subscribers is re-fetched; a cache-only entry (nobody
  // watching) is dropped, so the next subscribe fetches fresh — never
  // round-trip for a record that may have just been deleted (would 404).
  if (subs.get(key)?.size) void load(key)
  else cache.delete(key)
}
```

`invalidatePrefix(prefix)` applies `invalidate` to every key starting with the
prefix.

### Hooks

| Hook | Cache key | Returns |
| --- | --- | --- |
| `useGraphData(graphId)` | `graph:<id>` | `{ placements, edges }` |
| `useFile(fileId)` | `file:<id>` | `FileRecord \| null` |
| `useAppearsIn(nodeId)` | `appears:<id>` | `AppearsIn` |
| `useLooseEnds()` | `loose-ends` | `LooseEnds` |
| `useGraphCount(graphId)` | (reuses `graph:<id>`) | `placements.length` |
| `useUsage(table, id)` | `usage:<table>:<id>` | `number` |
| `useUndoRedo()` | (SSE-fed external store) | `{ canUndo, canRedo }` |

`useGraphCount` reuses `useGraphData` rather than hitting a separate endpoint.
`useUndoRedo` is not part of the query cache — it reads a tiny external store fed
directly by SSE (below).

### Vocab and the content store

`refreshVocab()` fetches `GET /api/vocab` and pushes the four collections into
the Zustand `useContentStore` (`setNodes` / `setKinds` / `setRelationTypes` /
`setGraphs`). The content store merges by id and preserves object identity when
`updatedAt` is unchanged, so per-id selector subscribers (node cards) only
re-render for rows that actually changed.

## SSE: reactivity

`connectEvents()` opens one `EventSource` to `/api/events`. It is idempotent (a
`connected` guard) and relies on `EventSource`'s built-in auto-reconnect.

```ts
es.onmessage = (e) => {
  if (!e.data) return                       // ignore keep-alive pings
  const event = JSON.parse(e.data)          // CommandEvent + canUndo/canRedo
  applyEvents(event.events)                 // invalidate the cache
  undoRedo = { canUndo: event.canUndo, canRedo: event.canRedo }
  undoSubs.forEach((cb) => cb())            // wake useUndoRedo subscribers
}
```

Each message's `data` is the `JSON.stringify` of a `CommandEvent` plus
`canUndo` / `canRedo`. Empty-data `ping` messages (the server's 30-second
keep-alive) are ignored. Every message updates the SSE-fed undo/redo store and
runs `applyEvents` over the `StoreEvent[]`.

## `applyEvents` — the invalidation map

`applyEvents` is the inverse of the command layer's event emission: each
`StoreEvent` maps to the cache keys it touches.

| Store event | Invalidations |
| --- | --- |
| `placements-changed { graphIds }` | `graph:<g>` per id; `loose-ends`; prefix `appears:` |
| `edges-changed { graphIds }` | `graph:<g>` per id; prefix `appears:`; prefix `usage:` |
| `nodes-changed { upserted, removed }` | `refreshVocab()`; prefix `appears:`; prefix `usage:`; `loose-ends` |
| `files-changed { fileIds }` | `file:<id>` per id |
| `graphs-changed { upserted, removed }` | `refreshVocab()`; `loose-ends` |
| `vocab-changed` | `refreshVocab()`; prefix `usage:` |
| `workspace-replaced` | `refreshVocab()`; prefix `graph:`; prefix `appears:`; `loose-ends` |

Because invalidation drops cache-only keys but re-fetches live ones, an event
for a graph nobody is viewing costs nothing, while the graph on screen re-fetches
and re-renders. This is what makes multi-tab convergence free: every connected
client receives the same broadcast and invalidates identically.

## SSE-fed undo/redo store

```ts
let undoRedo = { canUndo: false, canRedo: false }
const undoSubs = new Set<() => void>()
export function useUndoRedo() {
  return useSyncExternalStore(
    (cb) => { undoSubs.add(cb); return () => undoSubs.delete(cb) },
    () => undoRedo,
  )
}
```

The undo/redo affordances never poll. Their availability is pushed on every
broadcast (and refreshed by the `runUndo` / `runRedo` responses, which also carry
the flags), keeping toolbar buttons in sync across tabs.
