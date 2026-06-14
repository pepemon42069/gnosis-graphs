# API reference

The complete HTTP + SSE contract served by `server/api.ts`. All data routes are
under `/api`; everything else falls through to the static SPA. The API is
registered **before** the static handler, so `/api/*` always wins. Request and
response bodies are JSON unless noted.

## Conventions

- `POST` routes that mutate funnel through the serialized write chain
  (`server/registry.ts`); responses include fresh `canUndo` / `canRedo` where
  relevant.
- Command failures (unknown kind, integrity errors, plan errors) return
  `400 { ok:false, error:string }`.
- A `result` record on `POST /api/command` holds only the string id fields the
  command minted: any of `nodeId`, `fileId`, `placementId`, `graphId`,
  `edgeId`, `relationTypeId`, `kindId`.

## Commands and history

### `POST /api/command`

Run one command by kind through the serialized write chain.

- **Body:** `{ kind: string, args?: Record<string, unknown> }`
- **200:** `{ ok:true, result: Record<string,string> }` — `result` holds whichever minted id fields apply.
- **400:** `{ ok:false, error:string }` on throw (e.g. `Unknown command kind: <kind>`, or an integrity error).

**Command kinds.** Every value `kind` may take:

```
create-node            update-node-meta       create-sub-graph
link-child-graph       delete-node-everywhere delete-nodes-everywhere
set-node-title         set-file-content       set-node-file
rename-node-file       set-node-link          add-placement
move-placements        remove-from-canvas     create-edge
delete-edges           retype-edge            reverse-edge
import-markdown-folder decompose-into-graph   create-graph
rename-graph           delete-graph           delete-graph-deep
create-kind            rename-kind            recolor-kind
merge-kind             delete-kind            create-relation-type
rename-relation-type   recolor-relation-type  merge-relation-type
delete-relation-type
```

**`decompose-into-graph`** has a richer payload than the rest: it materializes a
decomposed markdown document as a brand-new graph in one undo step. Prefer the
[`POST /api/decompose`](#post-api-decompose) route below — it auto-lays-out the
result — over calling this kind directly (which places on a plain grid).

- **`args`:** `{ graphName: string, concepts: Concept[], relations: Relation[] }`,
  where `Concept = { key, title, kind?, tags?, summary?, filename?, content, position? }`
  and `Relation = { from, to, type }` (`from`/`to` are concept `key`s).
- **`result`:** `{ graphId }` — the new graph. It creates one node-with-markdown-file
  per concept, any missing kinds/relation types inline, and the typed directed edges;
  nothing existing is touched.

### `POST /api/decompose`

Decompose a markdown document into a brand-new graph **and lay it out** so it starts
legible. Authored by the `decompose-md` skill (`.claude/skills/decompose-md`); the
`scripts/decompose-post.mjs` helper posts here. See [Decomposing a document](/guide/decomposing-a-document).

- **Body:** `{ graphName, concepts: Concept[], relations: Relation[], layout? }` —
  `layout` is `'web'` (default, organic/compact), `'flow'` (left→right hierarchy), or
  `'grid'` (opt out). elk runs here, before dispatch, so the layout never holds the
  write transaction open.
- **200:** `{ ok:true, graphId:string }`
- **400:** `{ ok:false, error:string }` (e.g. a relation referencing an unknown key).

### `POST /api/undo`

Undo the last command.

- **Body:** none.
- **200:** `{ ok:true, canUndo:boolean, canRedo:boolean }`

### `POST /api/redo`

Redo the last undone command.

- **Body:** none.
- **200:** `{ ok:true, canUndo:boolean, canRedo:boolean }`

## Graph reads and the DSL

### `GET /api/graph/:id`

Canvas data for a graph.

- **200:** `{ placements: PlacementRecord[], edges: EdgeRecord[] }`

### `GET /api/graph/:id/source`

Serialize the graph to canonical DSL text.

- **200:** `{ source:string }`

### `POST /api/graph/:id/source`

Plan (`dryRun`) or apply a DSL edit. A destructive apply snapshots first.

- **Body:** `{ source:string, dryRun?:boolean }`
- **400:** `{ ok:false, errors: {line,message}[] }` on parse error.
- **200:** `{ ok:true, summary: PlanSummary }` on a `dryRun` or a successful apply.
- **500:** `{ ok:false, error:string }` if the pre-apply snapshot fails — the graph is **NOT** changed.
- **400:** `{ ok:false, error:string }` on a `PlanError` or apply throw.

The apply path: parse → plan → (if `dryRun`, return the summary) → if the plan
removes nodes, `writeSnapshot()` first (500 on failure, no change) → dispatch the
composite apply command as one undo step. See the [DSL engine](./dsl-engine).

## Nodes, files, and discovery

### `GET /api/file/:id`

Fetch one file record.

- **200:** `FileRecord`
- **404:** `null` when absent.

### `GET /api/files`

List every file for the sidebar file explorer — identity and filename only, never
content (which is fetched per-file on open).

- **200:** `Pick<FileRecord, 'id' | 'nodeId' | 'filename' | 'format' | 'language'>[]`

### `GET /api/node/:id/appears-in`

Graphs and parent nodes a node appears in.

- **200:** `AppearsIn` — `{ graphs: { graph, placement }[], parentNodes: NodeRecord[] }`

### `GET /api/loose-ends`

Unreferenced graphs and unplaced nodes.

- **200:** `LooseEnds` — `{ unreferencedGraphs: GraphRecord[], unplacedNodes: NodeRecord[] }`

### `GET /api/search`

MiniSearch over the workspace.

- **Query:** `q` (the search string).
- **200:** `{ id:string, type:'node'|'graph', title:string, score:number }[]`

## Vocabulary and graph records

### `GET /api/vocab`

Full vocab snapshot for the content store.

- **200:** `{ nodes: NodeRecord[], kinds: KindRecord[], relationTypes: RelationTypeRecord[], graphs: GraphRecord[] }`

### `GET /api/usage/kind/:id`

Node count using a kind.

- **200:** `{ count:number }`

### `GET /api/usage/relation-type/:id`

Edge count using a relation type.

- **200:** `{ count:number }`

### `POST /api/ensure/:table`

Ensure a kind or relation type by name (selects an existing case-insensitive
match, else creates). The `:table` param is `kind`; any other value is treated as
`relationType`.

- **Body:** `{ name:string }`
- **200:** `{ id:string }`

## Workspace import/export

### `GET /api/export`

Export the full workspace bundle.

- **200:** `WorkspaceBundle`

### `POST /api/import`

Replace the workspace from a bundle. Snapshots the current workspace first.

- **Body:** `WorkspaceBundle` (the raw request body).
- **200:** `{ ok:true }`
- **500:** `{ ok:false, error:string }` if the pre-import snapshot fails — the workspace is **NOT** replaced.

### `GET /api/meta`

Home / root / initial graph ids.

- **200:** `{ homeGraphId: string|null, rootGraphId: string|null, initialGraphId: string }`

## Events (SSE)

### `GET /api/events`

A Server-Sent-Events stream of every command broadcast, plus live undo/redo
availability. Keep-alive ping every 30 s.

- **Content-Type:** `text/event-stream`
- **Each message** `data` is `JSON.stringify(Broadcast)`, where

  ```ts
  type Broadcast = CommandEvent & { canUndo: boolean; canRedo: boolean }
  // = { label, transient, cascade, events: StoreEvent[], canUndo, canRedo }
  ```

- **Keep-alive:** a 30s `setInterval` emits an `event: 'ping'` message with empty
  `data` (ignored client-side: `if (!e.data) return`) to keep proxies from closing
  the connection. `onAbort` calls `clearInterval(ping)` and resolves the hold-open
  promise, so a disconnect leaves no dangling timer.

The `StoreEvent` union carried in `events`:

```ts
type StoreEvent =
  | { type: 'nodes-changed';      upserted: string[]; removed: string[] }
  | { type: 'files-changed';      fileIds: string[] }
  | { type: 'graphs-changed';     upserted: string[]; removed: string[] }
  | { type: 'placements-changed'; graphIds: string[] }
  | { type: 'edges-changed';      graphIds: string[] }
  | { type: 'vocab-changed' }
  | { type: 'workspace-replaced' }
```

Server side, the `onCommand` handler spreads `...undoState()` onto every
`CommandEvent` and fans it out to all connected clients (a `Set` of `emit`
functions). Client side, `connectEvents` parses `e.data`, runs
`applyEvents(event.events)` to invalidate the cache, and updates the SSE-fed
undo/redo store. `EventSource` auto-reconnects; `connectEvents` is idempotent.

## Static docs + SPA

Registered after `/api` (so the API always wins) and `/docs/*` before `/*` (so docs never fall through to the SPA).

| Registration | Path | Purpose |
| --- | --- | --- |
| `app.use('/docs/*', serveStatic({ root: GNOSIS_DOCS, rewriteRequestPath }))` | `/docs/*` | Serve the built VitePress docs. Root is `GNOSIS_DOCS` (default `./docs/.vitepress/dist`). |
| `app.get('/docs/*', serveStatic({ path: '${GNOSIS_DOCS}/index.html' }))` | `/docs/*` | Docs fallback — serve the docs `index.html`. |
| `app.use('/*', serveStatic({ root: GNOSIS_STATIC }))` | `/*` | Serve the built SPA assets. Root is `GNOSIS_STATIC` (default `./dist`). |
| `app.get('/*', serveStatic({ path: '${GNOSIS_STATIC}/index.html' }))` | `/*` | SPA fallback — serve `index.html` for any client-side route. |
