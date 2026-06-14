---
name: doc-sync
description: >
  Keeps the VitePress docs under docs/ in sync with the code they describe.
  Use this skill whenever code in server/, src/data/, or src/data/source/ changes
  on a branch, or when the user asks to "update the docs", "check the docs",
  "are the docs still accurate", "sync docs to code", "did this change break the
  docs", or after landing a feature that touched routes / command kinds / the DSL
  grammar / records / env vars. It maps changed code regions to the docs that own
  them, re-derives the authoritative facts from source, and reports (and repairs)
  drift. It proposes and edits docs ONLY — it never edits code.
allowed-tools:
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Bash
---

# doc-sync

The docs site under `docs/` is the source of truth for gnosis-graphs. When the
code moves, the docs must follow. This skill finds the docs that own each changed
code region, re-derives the facts from source, and fixes any drift.

**Hard rule: this skill edits docs only. Never modify code, tests, or config to
make the docs "true" — the code is authoritative; the docs follow it.**

## When to use

- Code under `server/`, `src/data/`, or `src/data/source/` changed on the branch.
- The user asks to update / check / sync the docs, or asks whether a change broke them.
- A PR added or renamed a route, command kind, env var, DSL key, or record field.

## When NOT to use

- Pure UI-styling changes with no doc-bearing surface (no routes, no records, no DSL).
- Writing brand-new doc pages from scratch — that is authoring, not sync. (Sync
  repairs existing pages and can add a missing row, not design a new chapter.)

## Procedure

### 1. Find what changed

Diff the branch against its base (default `main`; pass an explicit base if the
user names one):

```bash
git fetch origin --quiet 2>/dev/null || true
BASE="${BASE:-main}"
git diff --name-only "$(git merge-base HEAD "$BASE")"...HEAD
```

Keep only files under `server/`, `src/`, `package.json`, `Dockerfile`,
`docker-compose.yml`, and `scripts/`.

### 2. Map each changed file to the doc(s) that own it

| Changed code | Owning doc(s) |
| --- | --- |
| `server/api.ts` | `docs/architecture/api-reference.md` |
| `server/registry.ts`, `graphSource.ts`, `snapshots.ts`, `files-mirror.ts`, `migrateLive.ts` | `docs/architecture/server.md` |
| `src/data/source/*` (parse, plan, serialize, layout) | `docs/guide/dsl-reference.md` + `docs/architecture/dsl-engine.md` |
| `src/data/types.ts`, `src/data/bundle/*` | `docs/architecture/data-model.md` |
| `src/data/client.ts`, `src/data/events.ts` | `docs/architecture/client-seam.md` |
| `src/data/commands/*`, `src/data/store/*`, `src/data/db.ts` | `docs/architecture/data-and-commands.md` |
| `package.json`, `Dockerfile`, `docker-compose.yml`, `scripts/*` | `docs/architecture/build-and-deploy.md` + `README.md` |
| `src/nav/*`, `src/keyboard/*`, view components (`src/App.tsx`, canvas/panel/doc views) | `docs/guide/using-the-canvas.md` |
| `server/main.ts` (boot order, env defaults) | `docs/architecture/overview.md` + `docs/guide/getting-started.md` |

Build the set of touched docs. If a changed file is not in the table, note it as
**unmapped** in the report rather than guessing a target.

### 3. Re-derive the authoritative facts from source

For each touched doc, open the cited source and transcribe — do not paraphrase —
the facts that doc claims:

- **api-reference.md** → the route table. Every `app.get/post/use(...)` in
  `server/api.ts` (method, path, request body shape, success + error responses,
  status codes), the `/api/events` SSE payload (`Broadcast = CommandEvent & { canUndo, canRedo }`),
  and the SPA static + fallback at the bottom.
- **server.md / data-and-commands.md** → the `FACTORIES` map keys in
  `server/registry.ts` (the complete command-kind list), the serialized write
  chain, `dispatchComposite`, and the `GnosisDB`/`getDb()` seam.
- **dsl-reference.md / dsl-engine.md** → the node keys
  (`KEYS = new Set([...])`), the `TOKEN` and `EDGE` regexes, the 8-char anchor
  prefix, comment + block rules, and the apply semantics (full-sync deletion,
  inline vocab ensure, content-never-written) from `src/data/source/parse.ts`,
  `plan.ts`, `serialize.ts`, and `server/graphSource.ts`.
- **data-model.md** → record field lists from `src/data/types.ts`, the
  `Payload` union, `WorkspaceBundle`, and `SCHEMA_VERSION`.
- **client-seam.md** → the `StoreEvent` union and the hook/invalidation map from
  `src/data/events.ts` + `src/data/client.ts`.
- **getting-started.md / build-and-deploy.md / README** → the `GNOSIS_*` / `PORT`
  defaults from `server/main.ts` and `Dockerfile`, and the `scripts` block in
  `package.json`.

### 4. Report drift, then repair

For every touched doc, compare the doc's claims to the re-derived facts. Report
each drift as a line item:

```
<doc path>:<line> — <what the doc says> ≠ <what the code says> (source: <file:line>)
```

Then repair: edit the doc so it matches the code exactly (add a missing route
row, fix a renamed command kind, correct an env default, update a changed regex
or field). Preserve the doc's existing structure, tone, and tables. If a change
is large enough to need a new section the doc does not have, flag it for a human
rather than inventing prose.

### 5. Verify

Run the docs build to confirm no broken internal links and a clean render:

```bash
pnpm docs:build
```

Report: the changed files, the doc→source mappings you checked, each drift found
(with line refs), the repairs applied, any unmapped changes, and the
`docs:build` result.
