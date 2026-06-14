---
name: decompose-md
description: >
  Decompose a markdown document into a gnosis-graphs knowledge graph: isolated
  concepts become separate nodes (each with its own markdown file + kind/tags/
  summary), linked by typed directed edges. You (Claude Code) do the
  decomposition — read the doc, find the concept boundaries and relationships —
  then materialize it by calling the running app's HTTP API. Always creates a
  brand-new graph, so it never touches existing data. Use this skill when the user
  points at a markdown file and asks to "decompose this", "turn this doc into a
  graph", "break this into concepts", or "build a knowledge graph from this".
allowed-tools:
  - Read
  - Write
  - Bash
---

# decompose-md

Turn one markdown document into a concept graph in the running gnosis-graphs app.
The intelligence is yours: read the doc, split it into *isolated concepts*, decide
each concept's metadata + content, and infer the *typed, directed relationships*
between them. Then materialize the whole thing with a single HTTP call to the
`decompose-into-graph` command — one undo step, a fresh graph, nothing existing
touched.

## When to use

- The user gives a local markdown file path and wants it decomposed into a graph.
- "Break this doc into concepts", "build a knowledge graph from these notes",
  "turn this spec into nodes + relations".

## Inputs

- **Document** — a local markdown file path. `Read` it.
- **Server origin** — default `http://localhost:8787` (the `pnpm server` / docker
  compose instance). Override if the user runs the server elsewhere.

## Procedure

### 1. Confirm the server and read existing vocabulary

```bash
ORIGIN=http://localhost:8787
curl -fsS "$ORIGIN/api/meta" >/dev/null || { echo "server not reachable at $ORIGIN"; exit 1; }
curl -fsS "$ORIGIN/api/vocab"   # existing kinds + relationTypes (and nodes/graphs)
```

Note the existing `kinds[].name` and `relationTypes[].name`. **Prefer reusing
them** over inventing near-duplicates — the command matches case-insensitively
(so `Concept` reuses `concept`), but it will *not* merge semantic twins like
`depends on` vs `depends-on`. Pick the existing name when one fits.

### 2. Decompose the document (this is the work)

Read the doc and produce a list of **concepts** and a list of **relations**.

**What is a concept?** A single, self-contained idea — a definition, claim,
entity, method, question, or example. Headings are *hints* at boundaries, not a
1:1 mapping:

- **Split** a section that bundles several independent ideas into one node per idea.
- **Merge** a heading that is just a label over a single idea with its body.
- Aim for nodes that each make sense on their own.

For each concept, decide:

- `key` — a stable slug, unique within this run (e.g. `attention-mechanism`).
  Relations reference concepts by this key.
- `title` — a short human title.
- `kind` — classify it (`concept`, `definition`, `claim`, `example`, `question`,
  `method`, `person`, `reference`, …). Reuse an existing kind when one fits.
- `tags` — a few cross-cutting labels (optional).
- `summary` — one line for the graph card (optional but encouraged).
- `content` — the **self-contained markdown** for this concept: pull the relevant
  prose so the node reads on its own. Do **not** paste the whole document into
  every node.
- `filename` — optional; defaults to a slug of the title + `.md`.

**Relations** are typed and directed — `from → to` should read as a sentence:

- `defines`, `depends-on`, `part-of`, `example-of`, `supports`, `contradicts`,
  `cites`, `precedes`, `generalizes`, … Reuse existing relation types when they fit.
- Only assert a relation the text actually supports. Direction matters
  (`A depends-on B` ≠ `B depends-on A`).

### 3. Materialize via the helper

Write the payload JSON to a file (avoids shell-escaping the markdown), then run the
committed helper — it validates, POSTs to `/api/decompose`, and prints the result:

```bash
# Write /tmp/decompose-payload.json (see contract below), then:
node scripts/decompose-post.mjs /tmp/decompose-payload.json "$ORIGIN"
# ✓ created graph <uuid>
#   N concept-nodes, M typed edges (layout: web)
#   open:  $ORIGIN/#/g/<uuid>
```

`/api/decompose` **auto-lays-out** the new graph (default style `web` — organic and
compact; pass `"layout": "flow"` for a left→right hierarchy, or `"grid"` to opt out),
so it starts legible. Re-running the in-app **Tidy** menu re-lays-out anytime.

### 4. Report

Tell the user:

- the new graph opens at `#/g/<graphId>` (it also appears live in any open tab via SSE),
- how many concept-nodes and typed edges were created,
- that a single undo reverts the whole thing: `curl -X POST "$ORIGIN/api/undo"`,
- that nothing existing was modified.

## The `/api/decompose` contract

```jsonc
POST /api/decompose
{
  "graphName": "string",                   // the new graph's name
  "layout": "web",                         // optional: "web" (default) | "flow" | "grid"
  "concepts": [
    {
      "key":      "string",                // stable, unique-per-run; referenced by relations
      "title":    "string",
      "kind":     "string?",               // reused case-insensitively; created if new
      "tags":     ["string", ...],         // optional
      "summary":  "string?",               // optional one-liner
      "filename": "string?",               // optional; defaults to <slug(title)>.md
      "content":  "string"                 // the concept's markdown body
    }
  ],
  "relations": [
    { "from": "key", "to": "key", "type": "string" }   // type reused/created like kinds
  ]
}
// → { "ok": true, "graphId": "<uuid>" }
// errors → 400 { "ok": false, "error": "..." }  (e.g. a relation referencing an unknown key)
```

The whole materialization is **one composite command = one undo step**: it creates a
new graph, one node-with-markdown-file per concept (auto-laid-out), any missing
kinds/relation types (inline), and the typed edges. `POST /api/undo` removes all of
it; `POST /api/redo` restores it. (The lower-level `decompose-into-graph` command kind
on `/api/command` still exists but places on a plain grid — prefer `/api/decompose`.)

## Safety

- **Always a new graph.** This command only ever creates; it never edits or deletes
  existing nodes/graphs. Do **not** reach for the DSL apply route
  (`POST /api/graph/:id/source`) for this — that path is full-sync and will delete
  anything not in the source.
- Confirm `GET /api/meta` succeeds before posting.
- `key`s must be unique within a run (the command rejects duplicates); every
  relation `from`/`to` must match a concept `key` (else the command 400s).
