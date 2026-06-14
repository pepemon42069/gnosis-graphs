# The server

Everything under `server/` is the self-hosted process: a Hono app, the
serialized write chain that drives the command layer, and three host-filesystem
projections (snapshots and the file mirror). This page covers the server
modules; the HTTP/SSE contract has its own [API reference](./api-reference), and
the DSL apply mechanics live in the [DSL engine](./dsl-engine) page.

## `registry.ts` — the write chain

`registry.ts` is the bridge between HTTP requests and the command layer. It owns
three things: the kind → factory map, the serialized write chain, and the
undo/redo + composite entry points.

### `FACTORIES`

A flat record mapping each command kind string to a factory that builds a
`Command` from the request `args`:

```ts
const FACTORIES: Record<string, (args: Args) => Command> = {
  'create-node': (x) => createNode(a(x)),
  'create-edge': (x) => createEdge(a(x)),
  'delete-node-everywhere': (x) => deleteNodeEverywhere(x.nodeId as string),
  // …one entry per command kind
}
```

It mirrors, one-to-one, every client-side `dispatch(factory(...))` the
browser-local app used to call in process. The full set of kinds is the same
list the picker and panel issue — see the [API reference](./api-reference) for
the exhaustive enumeration.

`runCommand(kind, args)` looks up `FACTORIES[kind]`, throws
`Unknown command kind: <kind>` if absent (surfaced as a `400` from
`POST /api/command`), dispatches the built command, and returns `resultOf` — the
string id fields the command minted, picked from
`nodeId / fileId / placementId / graphId / edgeId / relationTypeId / kindId`.

### The serialized write chain

SQLite is a single connection and the app is single-user, so transactions must
never interleave across concurrent HTTP requests. Every write funnels through
`serialize()`, a single promise chain:

```ts
let chain: Promise<unknown> = Promise.resolve()
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)        // run after the previous link settles
  chain = run.then(() => {}, () => {})  // swallow result/error to keep the chain alive
  return run
}
```

Note the `.then(fn, fn)`: the next write runs whether the previous one resolved
or rejected, so one failed command never wedges the chain. Five entry points all
route through it: `runCommand`, `dispatchComposite`, `runUndo`, `runRedo`, and
`ensureVocab`.

### `dispatchComposite`

```ts
export function dispatchComposite(command: Command): Promise<void> {
  return serialize(() => dispatch(command))
}
```

A pre-built composite `Command` (the DSL apply) is dispatched through the same
chain so it lands on the undo stack as **one** step and can't interleave with
other writes. `ensureVocab(table, name)` likewise serializes a call to
`ensureKind` / `ensureRelationType`, returning the existing-or-created id.

`undoState()` reads `canUndo()` / `canRedo()` off the dispatcher's stacks; the
API spreads it onto every SSE broadcast and every undo/redo response.

## `graphSource.ts` — one apply, one undo step

`buildApplyCommand(graphId, parsed)` returns a single composite `Command` whose
`do()` recomputes the plan from current DB state, runs each sub-command in
order, and records them for a reverse-order `undo()`. Because `do()` recomputes
the plan every time, the command is **re-runnable** as a redo. Its `cascade`
flag is dynamic — it becomes `true` only when the plan removes nodes.

Two invariants this module enforces:

- **Vocab is created inline.** Missing kind/relation names are created *within*
  the apply transaction via `createKind` / `createRelationType`, never
  `ensureKind` / `ensureRelationType` (those open their own transaction and push
  their own undo step, which would break the one-apply-one-undo contract).
  Lookup is case-insensitive.
- **Content is never written.** Only file/link *references* move. New file
  payloads are created with empty content; a pure filename change renames in
  place (preserving content) via `renameNodeFile`, otherwise the reference is
  switched with `setNodeFile` / `setNodeLink`.

The full grammar, plan, and apply rules live in the
[DSL engine](./dsl-engine) page. The route that calls this command
(`POST /api/graph/:id/source`), including the dry-run and pre-apply-snapshot
behaviour, is in the [API reference](./api-reference).

## `snapshots.ts` — full-bundle snapshots

A server-side replacement for the browser's OPFS ring. A complete
`WorkspaceBundle` is written to disk whenever the workspace is dirty.

| Knob | Value |
| --- | --- |
| `DIR` | `GNOSIS_SNAPSHOTS` (default `./snapshots`) |
| `KEEP` | `50` most recent files |
| `INTERVAL_MS` | `5 * 60_000` (5 minutes) |

`writeSnapshot()` writes `snapshot-<ISO-with-:.replaced-by->.json` of
`exportBundle()`, then prunes: it sorts the `snapshot-*.json` names and
`rmSync`s `slice(0, -KEEP)`. It **throws on failure** — the destructive-op guards
in the import and DSL-apply routes rely on this to refuse without a copy.

`startSnapshots()` wires two triggers:

- An `onCommand` listener sets `dirty = true` and, when `event.cascade`, runs
  `snapshotTick()` **immediately** (so a destructive cascade is captured at
  once).
- A 5-minute `setInterval` flushes a pending `dirty`.

`snapshotTick()` guards re-entry with a `writing` flag and re-marks `dirty` on
failure so the next tick retries.

## `files-mirror.ts` — one-way DB → FS reconcile

A write-through projection of the `files` table to the host filesystem so
external tools can **read** workspace content. It is strictly one-way: nothing
on disk ever flows back into the DB.

| Knob | Value |
| --- | --- |
| `DIR` | `GNOSIS_FILES` (default `./files`) |
| `DEBOUNCE_MS` | `250` |

**Naming.** Each file is written flat as `${slug(stem)}-${id.slice(0,8)}.${ext}`,
where `ext` is the filename's own extension when present, else `extFor(format,
language)`. `slug` lowercases, collapses runs of non-alphanumerics to `-`, trims
leading/trailing `-`, and defaults to `file` when empty.

**Reconcile + prune.** `reconcile()` `mkdirSync`s the dir, writes every DB file
under its stable name (recording the kept names in a `Set`), then walks
`readdirSync(DIR)` and prunes any on-disk entry not in the kept set with
`rmSync(…, { recursive: true, force: true })` — `recursive` keeps a stray
sub-directory from aborting the prune, and `force` swallows ENOENT races, so one
bad entry can't wedge subsequent reconciles.

`startFileMirror()` runs an initial `reconcile()` and registers an `onCommand`
listener that debounces a full reconcile (250 ms) whenever a command emits a
`files-changed` event.

## `migrateLive.ts` — live v2 → v3

When a database predates the file/link payload split (Phase 1), boot folds every
inline node payload into a file/link reference. `migrateLiveToV3(db)` runs one
transaction that:

- reads every node,
- skips nodes whose payload is already a `file` / `link` reference or absent,
- reuses `migrateNodeToV3` (the same helper the bundle migration uses) to rewrite
  the node, minting a `FileRecord` for non-empty content,
- `bulkAdd`s the new file records.

Because already-migrated and payload-less nodes are skipped, the migration is
safe to skip-guard on `meta.schemaVersion`: `main.ts` only runs it when the
stored `schemaVersion < 3`, then pins it to `SCHEMA_VERSION`. It must run
**before** `buildSearchIndex()` so the index reads file content, not stale
inline payloads.
