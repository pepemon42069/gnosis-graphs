# Data layer and the command pattern

Every mutation in gnosis-graphs is a `Command`. Reads are plain query functions.
Both run against the `GnosisDB` seam, which is satisfied by a synchronous SQLite
store on the server (and in tests). This page covers the command pattern, the
dispatcher, the database seam, and the SQLite backing.

## The `Command` interface

```ts
export interface Command {
  label: string
  /** Persists and emits events but never touches the undo/redo stacks. */
  transient?: boolean
  /** Destructive cascade — triggers an immediate snapshot after commit. */
  cascade?: boolean
  do(db: GnosisDB): Promise<StoreEvent[]>
  undo(db: GnosisDB): Promise<StoreEvent[]>
}
```

A command is a closure built by a factory. It captures whatever it needs to undo
itself — typically `structuredClone`s of the rows it is about to change — inside
`do`, and replays that captured state in `undo`. Both methods return the
`StoreEvent[]` describing what changed, which is how reactivity propagates.

Three properties shape dispatch:

- **`label`** — a human-readable name (e.g. `'create-node'`), carried on the
  emitted `CommandEvent`.
- **`transient`** — a live-typing command (`set-file-content`, `set-node-title`)
  that persists and emits but is **not** pushed on the undo stack; its `undo`
  throws `transientUndo()`. Structural undo skips over it and restores the prior
  durable state.
- **`cascade`** — a destructive command (delete-node, delete-graph, merge-kind,
  remove-from-canvas, …) that triggers an immediate snapshot after commit.

### Capture-and-replay, the careful version

Undo methods patch **only the fields the command changed**, not the whole row.
This is deliberate: a structural undo must not clobber transient edits made
after the command. For example, `updateNodeMeta.undo` restores
`title / summary / kindId / tags / updatedAt` but leaves the node's `payload`
(and any file-content edits) untouched. `deleteGraph` captures referring nodes
as `{ id, updatedAt }` pairs and re-points only their `childGraphId`, so title
or payload edits made after the delete survive the undo.

## The dispatcher — dual stacks

`src/data/commands/dispatcher.ts` owns two stacks and runs every command inside a
transaction:

```ts
async function run(command, direction) {
  const db = getDb()
  const events = await db.transaction('rw', db.tables, () =>
    direction === 'do' ? command.do(db) : command.undo(db),
  )
  emitCommand({
    label: command.label,
    transient: command.transient ?? false,
    cascade: command.cascade ?? false,
    events,
  })
}
```

- **`dispatch(command)`** runs `do`, then — unless the command is `transient` —
  pushes it on the undo stack and clears the redo stack. The undo stack is capped
  at `UNDO_CAP = 100`; the oldest entry is shifted off past the cap.
- **`undo()`** pops the undo stack, runs `undo`, and pushes the command onto the
  redo stack.
- **`redo()`** pops the redo stack, re-runs `do`, and pushes back onto undo.
- **`canUndo()` / `canRedo()`** report stack non-emptiness.
- **`clearHistory()`** empties both stacks — called on workspace import.

Every command runs in a single `db.transaction('rw', …)`, so a thrown error
(constraint violation, missing record) rolls back the whole command atomically.
The transaction wrapper returns the `StoreEvent[]`, which `emitCommand` fans out
to every `onCommand` listener (search index, snapshots, file mirror, SSE).

## Cascade → snapshot

When a `cascade: true` command commits, its `CommandEvent.cascade` is `true`. The
snapshots listener (`server/snapshots.ts`) reacts by running `snapshotTick()`
immediately rather than waiting for the 5-minute interval, so destructive
deletions are always captured before the user can lose them.

## The command factories

Commands are grouped by domain, one file per concern under
`src/data/commands/`:

| File | Commands |
| --- | --- |
| `nodeCommands.ts` | `createNode`, `updateNodeMeta`, `createSubGraph`, `linkChildGraph`, `deleteNodeEverywhere` |
| `payloadCommands.ts` | `setNodeTitle` (transient) |
| `fileCommands.ts` | `setFileContent` (transient), `setNodeFile`, `renameNodeFile`, `setNodeLink` |
| `placementCommands.ts` | `addPlacement`, `movePlacements`, `removeFromCanvas` |
| `edgeCommands.ts` | `createEdge`, `deleteEdges`, `retypeEdge` |
| `graphCommands.ts` | `createGraph`, `renameGraph`, `deleteGraph` |
| `kindCommands.ts` | `createKind`, `ensureKind`, `renameKind`, `recolorKind`, `mergeKind`, `deleteKind` |
| `relationTypeCommands.ts` | `createRelationType`, `ensureRelationType`, `renameRelationType`, `recolorRelationType`, `mergeRelationType`, `deleteRelationType` |
| `integrity.ts` | Shared guards + typed errors (`requireNonEmptyTitle`, `findVocabByNameCI`, `PlacementExistsError`, `DuplicateNameError`, `VocabInUseError`, `HomeDeletionError`, …) |

Factories that mint an id expose it synchronously on the returned command
(`createNode().nodeId`, `createEdge().edgeId`, etc.) — `crypto.randomUUID()` is
called at build time, before `do` runs. The server's `resultOf` reads those
fields back as the HTTP response. This synchronous minting is what lets the DSL
apply build a complete `token → nodeId` map before resolving any edge.

The full event-emission and deletion-cascade matrix is documented in the
[data model](./data-model) page.

## The `GnosisDB` seam

`src/data/db.ts` declares a narrow table surface — `get / add / put / delete /
update / bulk* / clear / toArray / count / where / filter / orderBy` plus a
`transaction(mode, tables, fn)` — that the command layer, queries, bundle, and
integrity code all depend on. It is deliberately Dexie-shaped: the original
browser-local app spoke this interface against IndexedDB, and the seam let the
re-platform swap in SQLite with zero changes to the command code.

```ts
let override: GnosisDB | null = null
export function setDbOverride(db: GnosisDB | null): void { override = db }
export function getDb(): GnosisDB {
  if (!override) throw new Error('No database configured — call setDbOverride first')
  return override
}
```

The server builds a `SqliteStore` and calls `setDbOverride(db)` once at boot;
tests do the same with an in-memory store. There is no IndexedDB path anymore —
SQLite is the only store. `getMeta` / `setMeta` are thin helpers over the `meta`
table.

## `sqliteStore.ts` — the SQLite backing

`SqliteStore` implements the `GnosisDB` surface against `node:sqlite`'s
synchronous `DatabaseSync`. Its design choices:

- **Rows as a JSON `doc` plus indexed columns.** Each table is
  `CREATE TABLE name (<pk> TEXT PRIMARY KEY, <indexed cols> TEXT, doc TEXT NOT NULL)`.
  The full record is stored as `doc`; the columns the app filters on are
  extracted alongside it for indexed `.where(col)` lookups. Reads `JSON.parse`
  the `doc` back into a record.

  | Table | Indexed columns | Unique |
  | --- | --- | --- |
  | `nodes` | `childGraphId` | |
  | `files` | `nodeId` | |
  | `graphs` | — | |
  | `placements` | `graphId`, `nodeId` | `(graphId, nodeId)` |
  | `edges` | `graphId`, `fromNodeId`, `toNodeId`, `relationTypeId` | |
  | `relationTypes` | — | |
  | `kinds` | — | |
  | `meta` | — (pk `key`) | |

  The `placements` unique index `(graphId, nodeId)` is the one structural
  invariant SQLite enforces directly: a node is placed at most once per graph.

- **Async wrappers over synchronous writes.** Mutating methods are declared
  `async` so a thrown constraint error surfaces as a rejected promise (the
  command layer `await`s them and the transaction rolls back), while the
  underlying write still runs synchronously inside the surrounding `BEGIN` /
  `COMMIT`.

- **Depth-guarded transactions.** `transaction(mode, tables, fn)` only opens a
  real `BEGIN` / `COMMIT` at depth 0; nested calls (seed and import open their
  own transaction) join the outer one. Failure triggers `ROLLBACK`. The store
  opens in WAL mode with `foreign_keys = OFF` — referential integrity is the
  command layer's and the bundle validator's job, not SQLite's.

`Collection`, `WhereClause`, and `OrderedCollection` provide the lazy
Dexie-style query chain (`.where(col).equals(v)`, `.filter(fn)`, `.anyOf(vs)`,
`.orderBy(col).uniqueKeys()`, `.toArray()`, `.count()`, `.first()`, `.modify()`).

## `queries.ts` — the reads

Read paths are plain functions over `getDb()`, not commands:

| Query | Returns |
| --- | --- |
| `placementsByGraph(graphId)` | Placements in one graph. |
| `edgesByGraph(graphId)` | Edges in one graph. |
| `placementsOfNode(nodeId)` | A node's placements across all graphs. |
| `appearsIn(nodeId)` | `{ graphs, parentNodes }` — every graph holding a placement, and every node whose child graph contains it. |
| `looseEnds()` | `{ unreferencedGraphs, unplacedNodes }` — graphs no *placed* node points at (excluding Home), and nodes with zero placements. |
| `relationTypeUsage(id)` | Edge count using a relation type. |
| `kindUsage(id)` | Node count using a kind. |

These back the corresponding HTTP read routes; the server calls them directly
(see the [API reference](./api-reference)).
