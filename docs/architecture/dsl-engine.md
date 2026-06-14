# DSL Engine

The graph-source DSL is implemented as a small, layered pipeline. Each stage is pure
and narrowly scoped, and the boundaries between them are where the engine's
guarantees live. This page is the contributor's map of those stages.

[[toc]]

## Pipeline overview

```
text  ──parse.ts──▶  ParsedGraph  ──plan.ts──▶  Plan  ──graphSource.ts──▶  composite Command
                          ▲                                                       │
                          └──────────────── serialize.ts ◀───────────────────────┘
                                          (canonical text)
```

| Stage | File | Role | Side effects |
| --- | --- | --- | --- |
| Parse | `src/data/source/parse.ts` | text → structural `ParsedGraph` or line-numbered errors | none (no DB) |
| Plan | `src/data/source/plan.ts` | read-only diff of desired vs current graph | reads DB, writes nothing |
| Apply | `server/graphSource.ts` | build one composite `Command` from the plan | writes DB inside one undo step |
| Serialize | `src/data/source/serialize.ts` | graph → canonical DSL text | reads DB only |
| Layout | `src/data/source/layout.ts` | grid coordinates for new nodes | pure |

The HTTP seam is `POST /api/graph/:id/source` (parse → plan → optional snapshot →
apply) and `GET /api/graph/:id/source` (serialize). The dry-run/snapshot/dispatch
orchestration lives in `server/api.ts`, not in the engine files.

## Parse — `parse.ts`

`parseGraphSource(text)` is pure and deterministic. No DB, no
`@codemirror/language-data`. It returns a discriminated union:

```ts
type Parsed = { graph: ParsedGraph } | { errors: ParseError[] }
```

`{ graph }` is returned **only** when `errors.length === 0`; otherwise `{ errors }`.

Three regexes drive it:

```ts
const TOKEN = /^#(\S+)\s*(.*)$/
const EDGE  = /^#?(\S+)\s*->\s*#?(\S+)\s*:(.*)$/
const KEYS  = new Set(['kind', 'tags', 'summary', 'file', 'link'])
```

The line loop:

- Trims each line; skips blanks and `//` comments.
- An **indented** line (`indentOf(raw) > 0`) whose key is one of `KEYS`
  (`isKeyLine`) is applied to the **currently open** node via `applyKey`.
- Otherwise the line **closes** the open block (`current = null`). If it contains
  `->`, it's parsed as an edge; else as a node header via `parseHeader`.
- `parseHeader` runs `TOKEN`: a match yields `{ token, title }`; no match yields a
  node whose whole trimmed line is the title and which has no token.

`applyKey` is where the five keys are interpreted: `tags` splits on commas and drops
empties; empty `file`/`link` push a parse error; `kind`/`summary` collapse empty to
`undefined`.

After the loop, a second pass over `nodes` validates **cross-line** invariants:
`file` and `link` both present is an error, and an empty title is an error. Duplicate
anchors are caught inline during the loop via the `anchors` set.

::: tip Why two passes
Single-line errors (empty `file:` value, malformed edge) are pushed as the line is
read. Whole-node errors (both `file` and `link`, empty title) need the fully
assembled `ParsedNode`, so they run after. Either way the result is `{ errors }`.
:::

`ParsedGraph` is purely structural — `ParsedNode` carries an optional `token`,
`title`, `kind`, `tags`, `summary`, `file`, `link`, and its 1-based header `line`.
It knows nothing about node ids; that resolution is the plan's job.

## Plan — `plan.ts`

`planGraphSource(db, graphId, parsed)` is the **read-only diff**. It loads the graph's
current placements, edges, kinds, relation types, placed nodes, and their files, then
computes a `Plan`:

```ts
interface Plan {
  nodesToCreate: NodeCreate[]
  nodesToUpdate: NodeUpdate[]
  edgesToAdd: EdgeAdd[]
  edgesToRemove: string[]
  vocabToEnsure: { kinds: string[]; relations: string[] }
  nodesRemoved: NodeRemoval[]
  resolved: Map<string, string>   // token → existing nodeId
  summary: PlanSummary
}
```

### Token resolution

`resolveToken(token, placed, line)` filters placed nodes by `id.startsWith(token)`.
Resolution is **scoped to nodes placed in this graph**. More than one match throws a
`PlanError`:

```ts
throw new PlanError(`line ${line}: ambiguous anchor #${token} (matches ${matches.length} nodes)`)
```

A token that resolves becomes an update candidate; an unresolved token is recorded in
`resolved` as `''` (a placeholder for a node that will be minted) and becomes a
create. A header with no token is always a create.

### Node diffing

`diffNode` produces a `NodeUpdate` only if something changed. It compares `title`,
`summary`, `kind` (case-insensitively; absence clears the kind), and `tags` (order
sensitive via `sameTags`), and compares the **payload reference** — `currentRef`
reads the node's current `file` filename or `link` url, and the desired ref comes
straight from the parsed node. Returns `null` when neither meta nor payload changed,
which is what makes an unchanged re-apply a no-op.

### Edge diffing

Edges are keyed on `from|to|relation` with the relation lowercased:

```ts
const key = (from, to, rel) => `${from}|${to}|${rel.toLowerCase()}`
```

Desired edges whose key isn't in the current set are adds; an edge with an
unresolved (new-alias) endpoint can't form a key and is always an add. Current edges
whose key isn't desired are removes.

### Full-sync removals

Any placed node **not** seen in the source becomes a `NodeRemoval`: its placement id,
this graph's touching edge ids, and `deleteGlobal` — true iff
`placementsOfNode(node.id)` finds no placement in any **other** graph.

### Vocab collection

`collectVocab` walks the parsed nodes/edges and returns the kind and relation names
that don't already exist (case-insensitive). It only **names** the missing vocab; the
apply creates it.

### Summary

`PlanSummary` is derived counts. Note `edgeRemoves` is the size of a **set** unioning
`edgesToRemove` with the edges carried off by removed nodes, so an edge isn't
double-counted; `nodesDeleted` counts only removals with `deleteGlobal === true`.

## Apply — `server/graphSource.ts`

`buildApplyCommand(graphId, parsed)` returns one `Command`. **One apply = one
composite command = one undo step.** Its closure holds the executed sub-commands and a
`cascade` flag.

### `do()` is re-runnable

`do(db)` is written so that **redo works**: it resets its capture (`executed = []`),
**recomputes the plan from current DB state**, then runs sub-commands in order via a
`run` helper that records each into `executed`. `undo(db)` replays `executed` in
reverse, calling each sub-command's `undo`. Because `do` re-plans, a redo after other
edits still does the right thing relative to the live DB.

The sub-commands run in a fixed order:

1. **Vocab inline** — `ensureVocabInline` for kinds then relations.
2. **Create nodes** — `createNode(...)` with a grid placement; `createNode` mints its
   id **synchronously**, so the `tokenToNodeId` map is complete before any edge
   resolves.
3. **Update nodes** — `updateNodeMeta` for meta, then the payload reference.
4. **Edges** — `createEdge` for adds, `deleteEdges` for removes.
5. **Removals** — `removeFromCanvas` per omitted node, then `deleteNodeEverywhere`
   when `deleteGlobal`.

`cascade` is set to `plan.nodesRemoved.length > 0`; the server reads it to decide
whether a snapshot is warranted on the command stream.

### Vocab is inline, never `ensure*`

`ensureVocabInline` builds a name→id map and, for each missing name, runs
`createKind(name, '#8a8f98', '◆')` or `createRelationType(name)` **through the same
`run` helper** so it lands in this command's `executed` list. It deliberately does
**not** call `ensureKind` / `ensureRelationType`:

::: warning Don't use ensure* inside the apply
`ensureKind` / `ensureRelationType` open **their own transaction and push their own
undo step**. Calling them from inside the composite would split one apply into
multiple undo steps and could interleave transactions on the serialized write chain.
`ensureVocabInline` instead reuses the low-level `createKind`/`createRelationType`
commands so everything is captured in the **one** composite. Case-insensitive lookup
(via the prebuilt map and `findVocabByNameCI`) avoids creating duplicates.
:::

### References move, content never does

`applyPayloadRef` encodes the reference rules:

- `link` desired → `setNodeLink`.
- `file` desired, and the node currently has a file (no link) → `renameNodeFile`
  (**rename in place, content preserved**).
- otherwise `file` desired → `setNodeFile` (switch the reference).

`payloadOf` mints **new** file payloads with `content: ''`. No path through the apply
writes a file body — only references move.

### Endpoint safety

Each edge endpoint is looked up in `tokenToNodeId` (seeded from `plan.resolved`, then
filled with freshly minted ids). A missing endpoint throws
`line N: edge endpoint not found (#from -> #to)`. This can't normally fire because
node ids are minted synchronously before edges run, but it guards the invariant.

## Serialize — `serialize.ts`

`serializeGraphSource(db, graphId)` is the inverse: graph → canonical text. It is the
source of truth for **canonical form**, which is what makes the round-trip an
identity.

- **Stable order.** `byCreatedThenId` sorts both nodes (via placements) and edges by
  `createdAt`, then `id` as a tiebreaker. Order is therefore deterministic and
  independent of insertion timing.
- **8-char tokens.** `token(id) = id.slice(0, TOKEN_LEN)` with `TOKEN_LEN = 8` — the
  same prefix length `plan.ts` resolves against.
- **Node block.** `serializeNode` emits `#<token> <title>`, then `kind`, `tags`
  (joined with `, `), `summary`, and `file`/`link` — each only when present. A node
  with a child graph gets the documentary `  // opens: <childGraphName>` comment.
- **Edge line.** `serializeEdge` emits `#<from> -> #<to> : <relation>`, defaulting a
  missing relation name to `relates to`.
- **Layout.** Node blocks first, then a single edges section, joined by blank lines,
  trailing newline.

### The round-trip invariant

> `serialize → parse → plan` is a **no-op** on an unchanged graph.

Serialize emits canonical text; parsing it yields a `ParsedGraph` that resolves every
token back to its node by 8-char prefix; the plan diffs that against the same DB state
and finds nothing changed — zero creates, updates, edge adds/removes, or removals.
This is why opening the source editor and applying without edits is safe.

Tested in two places:

- `src/data/source/serialize.test.ts` — "round-trips: serialize → parse → serialize
  is idempotent" asserts the serialized text parses cleanly and re-serializing yields
  **identical** text (stable order).
- `server/graphSource.test.ts` — "round-trips: serialize the result and it parses
  without errors" applies source, serializes the result, and re-applies it as a
  `buildApplyCommand`, confirming the re-apply is a no-op.

## Layout — `layout.ts`

`nextPlacementPosition(existing, indexAmongNew)` is pure. New nodes carry no
coordinates from the DSL, so they're placed on a deterministic grid **below the
existing bounding box**:

```ts
const COL_WIDTH = 220
const ROW_HEIGHT = 140
const COLUMNS = 4
const GAP = 80
```

`baseX` is the minimum x of existing placements (0 on an empty graph); `startY` is the
bottom of the bounding box plus `ROW_HEIGHT + GAP` (0 on an empty graph). The index
among new arrivals maps to `(col, row)` over 4 columns. Same source, same grid.

## Where to look first

| You want to change… | Start in |
| --- | --- |
| Accepted syntax / keys / a new parse error | `parse.ts` |
| What counts as a change (diff rules, edge keying) | `plan.ts` |
| The order/shape of writes, vocab handling, reference moves | `server/graphSource.ts` |
| Canonical output (order, tokens, emitted keys) | `serialize.ts` |
| Auto-placement geometry | `layout.ts` |
| HTTP flow, dry-run, pre-apply snapshot | `server/api.ts` (`POST /api/graph/:id/source`) |

When changing the canonical form, update both round-trip tests above — they are the
guard that keeps serialize and parse in lockstep.
