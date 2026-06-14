---
name: gnosis-review
description: >
  Project-specific review dimensions for gnosis-graphs that AUGMENT the built-in
  /code-review — it does not replace general review. Use this skill alongside a
  normal code review whenever changes touch the command/undo layer
  (src/data/commands/*, the dispatcher), the DSL engine (src/data/source/*,
  server/graphSource.ts), the server write chain (server/registry.ts), the
  store/db seam (src/data/db.ts, src/data/store/*), the client seam
  (src/data/client.ts, src/data/events.ts), or any destructive operation. Trigger
  on phrases like "review this branch", "review the gnosis way", "check command
  atomicity", "is the DSL round-trip still intact", or "does this respect the
  store seam". Output findings tagged by dimension with file:line and a fix; skip
  nits.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# gnosis-review

A checklist of the review dimensions that are specific to gnosis-graphs. Run the
built-in `/code-review` for general correctness, reuse, and simplification first;
this skill adds the project invariants that a general reviewer will not know to
check. **Do not rebuild general review here — only apply the dimensions below.**

For each dimension, read the cited code and report any violation as:

```
[<dimension>] <file>:<line> — <what's wrong> → <suggested fix>
```

Skip nits. A finding must be a real correctness, safety, or invariant violation.

## Dimension 1 — Command / undo atomicity

Every mutation must be a `Command` dispatched through the dispatcher, and
`do()`/`undo()` must be exact inverses.

- Every state change goes through a `Command` (in `src/data/commands/*`) and is
  dispatched — nothing writes to the DB outside a command's `do()`.
- `undo()` exactly reverses `do()`. Captured prior state is restored, not
  approximated. `do()` is re-runnable (redo recomputes from current state).
- `cascade: true` is set on any destructive command (deletes, merges, full-sync
  apply) — the snapshot system keys off it.
- Nothing bypasses `dispatch` or the serialized write chain (`serialize()` in
  `server/registry.ts`). All writes funnel through `runCommand` /
  `dispatchComposite` / `runUndo` / `runRedo` / `ensureVocab`.
- **No `ensureKind` / `ensureRelationType` inside a composite apply.** They open
  their own transaction and push their own undo step, which breaks
  one-apply-=-one-undo-step. The DSL apply must create vocab inline
  (`ensureVocabInline` in `server/graphSource.ts`), never via the `ensure*`
  commands.

## Dimension 2 — Language-data layering

The pure DSL/parse layer stays DB-free and editor-free.

- `src/data/source/parse.ts`, `plan.ts`, `serialize.ts`, `layout.ts` must NOT
  import the DB (`getDb`, `db.ts`) or `@codemirror/language-data` (or any
  `@codemirror/*` / editor module). `parse.ts` is pure and deterministic.
- DB access for the DSL belongs in `plan.ts`'s caller and `server/graphSource.ts`,
  not in the parser. Grep the source dir for forbidden imports:
  `grep -rE "@codemirror|getDb|data/db" src/data/source/`.

## Dimension 3 — DSL round-trip integrity

`serialize → parse → plan` is a no-op on an unchanged graph.

- Serializing a graph then re-applying that source produces zero creates,
  updates, edge adds/removes, placement removals, and deletions.
- Serialization order is stable (createdAt then id) and tokens are the 8-char id
  prefix (`tokenLen` 8). A changed order or token width breaks anchors.
- Full-sync deletion logic is intact: a node placed in the graph but omitted from
  the source loses its placement + this graph's touching edges; if it is then
  placed nowhere else, `deleteGlobal` runs `deleteNodeEverywhere`.
- Anchor resolution stays scoped to nodes placed in THIS graph and errors on an
  ambiguous prefix.
- Confirm coverage exists in `src/data/source/serialize.test.ts` /
  `plan.test.ts` / `server/graphSource.test.ts`.

## Dimension 4 — Lean code

Matches the CLAUDE.md coding guidelines.

- Files are short and single-purpose (~150–200 lines max). Flag a file that grew
  past that or started mixing concerns and suggest the split.
- No speculative options, unused props, or dead code. Duplicate twice before
  extracting a shared helper.
- Modules are side-effect-free at import time — work happens in functions, not at
  the top level.

## Dimension 5 — Store-seam discipline

All data access goes through the `GnosisDB` interface and the SSE invalidation
map stays consistent.

- Reads and writes go through `getDb()` / the `GnosisDB` interface
  (`src/data/db.ts`), never a raw SQLite handle in app/command code.
- Server writes are serialized through the write chain so SQLite transactions
  never interleave.
- Each emitted `StoreEvent` has a matching client-side invalidation. Cross-check
  the events a command emits against `applyEvents` in `src/data/client.ts`: a
  new event field or a new event type without a matching invalidation is a stale
  cache waiting to happen.

## Dimension 6 — Data safety

Destructive operations snapshot first and refuse on snapshot failure.

- Any destructive server op (import replace, a DSL apply that removes nodes)
  calls `writeSnapshot()` BEFORE the destructive write and returns an error
  (refuses the op) if the snapshot throws — never destroy without a copy. See
  `server/api.ts` `/api/import` and `/api/graph/:id/source`.
- `writeSnapshot()` must throw on failure so those guards can detect it; a
  swallowed snapshot error defeats the guard.

## Output

A list of findings grouped by dimension, each with `file:line`, a one-line
description of the violation, and a concrete suggested fix. If a dimension is
clean, say so in one line. End with the single highest-priority item.
