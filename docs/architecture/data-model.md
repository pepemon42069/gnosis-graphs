# Data model

The workspace is seven record types plus a `meta` key/value table. Records are
defined in `src/data/types.ts`; the `WorkspaceBundle` (the export/import format)
inlines them all. This page documents each record, the payload union, the bundle
shape, and — re-verified against the current command code — the invariants and
deletion cascades.

## Records

All records extend `Timestamped` (`createdAt: number`, `updatedAt: number`).

### `NodeRecord`

```ts
interface NodeRecord extends Timestamped {
  id: string
  title: string
  kindId?: string
  tags: string[]
  summary?: string        // the graph-card blurb — the canvas shows this, never the payload
  payload?: Payload       // undefined ⇒ a pure graph-pointer node with no content
  childGraphId?: string
}
```

### `FileRecord`

```ts
interface FileRecord extends Timestamped {
  id: string
  nodeId: string          // the owning node
  filename: string
  format: PayloadFormat    // 'markdown' | 'plaintext' | 'code'
  language?: string
  content: string
}
```

Node content lives here, never inline on the node.

### `GraphRecord`, `PlacementRecord`, `EdgeRecord`

```ts
interface GraphRecord extends Timestamped { id: string; name: string }

interface PlacementRecord extends Timestamped {
  id: string; graphId: string; nodeId: string; x: number; y: number
}

interface EdgeRecord extends Timestamped {
  id: string; graphId: string; fromNodeId: string; toNodeId: string; relationTypeId: string
}
```

A placement is a node positioned on one graph's canvas. **Unique
`(graphId, nodeId)`**: a node is placed at most once per graph, enforced by a
SQLite unique index and re-checked by `addPlacement` (`PlacementExistsError`).
An edge belongs to a graph and connects two nodes by a relation type.

### `KindRecord`, `RelationTypeRecord`

```ts
interface KindRecord extends Timestamped { id: string; name: string; color: string; icon: string }
interface RelationTypeRecord extends Timestamped { id: string; name: string; color?: string }
```

Kinds classify nodes (color + icon, both required). Relation types classify
edges (color optional).

## The payload union

```ts
type PayloadFormat = 'markdown' | 'plaintext' | 'code'
type Payload =
  | { kind: 'file'; fileId: string }
  | { kind: 'link'; url: string }
```

A node's payload is a *reference*: a file (content in the `files` table) or a
link URL. A node with no payload is a pure graph pointer (e.g. the Home pointer
node). The model never carries content inline on the node — that was the v2
shape, folded into references by the v3 migration.

## `WorkspaceBundle`

The lossless export/import format inlines every table plus two meta pointers:

```ts
interface WorkspaceBundle {
  schemaVersion: number
  exportedAt: string
  nodes: NodeRecord[]
  graphs: GraphRecord[]
  placements: PlacementRecord[]
  edges: EdgeRecord[]
  relationTypes: RelationTypeRecord[]
  kinds: KindRecord[]
  files: FileRecord[]
  meta: { rootGraphId: string | null; homeGraphId: string | null }
}
```

`SCHEMA_VERSION = 3` (`src/data/bundle/migrate.ts`). Importing migrates a lower
bundle up the step ladder (`v(N-1) → vN`); a bundle from a *newer* schema is
rejected with `BundleTooNewError`. The live v2→v3 migration (`migrateLive.ts`)
applies the same node transform in place at boot.

## Invariants

Re-verified against the command and bundle code:

- **Placement uniqueness.** At most one placement per `(graphId, nodeId)` —
  SQLite unique index plus `addPlacement`'s `PlacementExistsError`.
- **Non-empty title.** `createNode` / `updateNodeMeta` / `setNodeTitle` run
  `requireNonEmptyTitle` (trims; throws `EmptyTitleError` on empty).
- **Node payload shape.** A node created with a `link` carries no file. Any
  other `createNode` mints a `FileRecord` — the supplied one or the default
  `untitled.md` (markdown, empty). So a non-link node always owns exactly one
  file; switching payload (`setNodeFile` / `setNodeLink`) deletes the prior file
  and re-points the reference.
- **One file per node.** The `files` table is indexed by `nodeId`; the file
  commands maintain a single current file reference per node, deleting the old
  file when the reference moves.
- **Home is undeletable.** `deleteGraph` throws `HomeDeletionError` for the
  `homeGraphId` graph.
- **Vocabulary names are unique (case-insensitive).** `createKind` /
  `renameKind` / `createRelationType` / `renameRelationType` reject a colliding
  name via `findVocabByNameCI` + `DuplicateNameError`. `ensureKind` /
  `ensureRelationType` select the existing match instead of duplicating.
- **In-use vocab can't be deleted.** `deleteKind` / `deleteRelationType` throw
  `VocabInUseError` when any node/edge references the entry; the in-use path is
  `mergeKind` / `mergeRelationType` (re-point, then drop).
- **Bundle integrity at the import door.** `validateBundle` requires at least one
  graph and rejects every dangling reference (placements/edges → graph/node,
  edges → relation type, files → node, nodes → kind/child-graph/file, meta
  pointers → graph). Nothing is touched on failure — pure checks.
- **`childGraphId` references an existing graph.** Enforced on import; cleared by
  `deleteGraph` when that graph is removed.

## Deletion-cascade matrix

How each destructive command (`cascade: true`) cascades, what survives, and the
events it emits:

| Command | Cascades / clears | Survives | Emits |
| --- | --- | --- | --- |
| `deleteNodeEverywhere(nodeId)` | the node's files, all its placements, and every edge touching it (both directions, all graphs) | — | `nodes-changed`, `files-changed`, `placements-changed`, `edges-changed` |
| `deleteGraph(graphId)` | the graph's placements and edges; clears `childGraphId` on referring nodes; refuses Home | the referring **nodes** themselves (only the pointer is cleared) | `graphs-changed`, `placements-changed`, `edges-changed`, `nodes-changed` |
| `removeFromCanvas(placementIds, edgeIds)` | the given placements, the graph-local edges touching those nodes, plus any explicitly selected edges | the **nodes** always survive (they stay in the workspace) | `placements-changed`, `edges-changed` |
| `mergeKind(fromId, intoId)` | re-points every node of `fromId` onto `intoId`, then deletes `fromId` | the nodes (re-classified) | `vocab-changed`, `nodes-changed` |
| `mergeRelationType(fromId, intoId)` | re-points every edge of `fromId` onto `intoId`, then deletes `fromId` | the edges (re-typed) | `vocab-changed`, `edges-changed` |
| `deleteKind` / `deleteRelationType` | deletes only when unused (else `VocabInUseError`) | everything (refused if in use) | `vocab-changed` |

Every cascade captures the rows it removes (`structuredClone`) and restores them
in `undo`, so the destruction is fully reversible. Undo patches only the fields
the command changed on still-present rows (e.g. re-setting `childGraphId` /
`kindId` / `relationTypeId`), so edits made after the delete survive the undo.

### A note on `files-changed`

When a file is *removed* (payload switched, or its owner deleted), the
`files-changed` event still fires so the FS mirror reconciles — but the removed
file id is **left out of `fileIds`**. The client must not re-fetch a deleted
file (it would 404), and the owner node is already reindexed by the accompanying
`nodes-changed`. Added file ids are included.
