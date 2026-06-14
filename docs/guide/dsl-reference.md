# DSL Reference

gnosis-graphs lets you author a graph as plain text. Open any graph's source editor
at `#/g/<id>/source`, edit the text, and apply it. The text is the graph: nodes,
their metadata, and the typed edges between them.

[[toc]]

## What the DSL is

The DSL is a **per-graph authoring format**. One block of text describes the nodes
placed in a single graph and the edges that connect them. It is not a global
document — each graph has its own source.

Three properties make it predictable:

- **One apply is one undo step.** Applying source runs as a single composite
  command. Whatever it creates, updates, re-types, or deletes is reverted in full
  by one Undo (and re-applied by one Redo).
- **It round-trips with the serializer.** The editor opens pre-filled with the
  canonical serialization of the current graph. If you apply that text unchanged,
  nothing happens — no creates, no updates, no removals. You only describe the
  *desired* end state; the engine diffs it against what exists.
- **Content is never written through the DSL.** The DSL moves *references*
  (which file or link a node points at) and node *metadata*. It never writes file
  bodies. The body of `notes.md` is edited in the document view, not here.

A graph's source has two kinds of lines: **node blocks** and **edge lines**, separated
by blank lines.

## Grammar

### Node header

A node block starts with a header line:

```
#<token> <title>
```

- The header regex is `/^#(\S+)\s*(.*)$/`. The `<token>` is everything after `#`
  up to the first whitespace; the rest of the line (trimmed) is the **title**.
- A header **without** a leading `#` is a brand-new node whose entire trimmed line
  is the title, with no alias. Example: the line `Transformers` declares a new node
  titled "Transformers".
- A node with an **empty title** is a parse error.

### Indented keys

Lines **indented** below a header attach to that node block. Each is a
`key: value` pair. The key is case-insensitive and must be one of exactly five keys:

| Key | Value | Notes |
| --- | --- | --- |
| `kind` | a kind name | Auto-created if it doesn't exist (see [vocab](#vocab-auto-ensure)). Empty value clears the kind. |
| `tags` | comma-separated list | Split on commas, each trimmed; empty entries dropped. |
| `summary` | free text | Empty value clears the summary. |
| `file` | a filename | Mutually exclusive with `link`. Empty value is a parse error. |
| `link` | a URL | Mutually exclusive with `file`. Empty value is a parse error. |

```
#a1b2c3d4 Attention Is All You Need
  kind: paper
  tags: ml, attention, nlp
  summary: The original transformer paper.
  link: https://arxiv.org/abs/1706.03762
```

A node may have **`file` or `link`, never both** — declaring both is a parse error.

::: warning Omitting a payload leaves it unchanged
You can *switch* a node between `file` and `link` from source, but **omitting** the
`file:`/`link:` line does not clear the payload — it leaves the existing reference
untouched (so the plan reports no update). Clearing a reference, and deleting the
underlying file, is a panel action, not a source edit. The canonical serialization
always emits the line, so a normal round-trip never drops it.
:::

Only an *indented* line whose key is one of the five is treated as a key. A
column-0 line (indent 0), or an indented line whose key is not recognized, **closes
the current node block** and starts a new one.

### Edges

An edge is a first-class header line. **Any** non-indented line containing `->` is
parsed as an edge:

```
#a1b2c3d4 -> #e5f6a7b8 : cites
```

- The regex is `/^#?(\S+)\s*->\s*#?(\S+)\s*:(.*)$/`. The `#` is **optional** on both
  endpoints. The relation is everything after the colon, trimmed, and **must be
  non-empty** (empty relation is a parse error).
- The relation type is auto-created if it doesn't exist.
- A line containing `->` that doesn't match the regex is a "malformed edge" parse
  error.

### Comments and blank lines

- A trimmed line starting with `//` is a comment and is skipped. Blank lines are
  skipped too (and serve to separate blocks).
- The serializer emits one informational comment under a node that links to a child
  graph: `  // opens: <childGraphName>`. It is purely documentary — comments are
  never parsed back into structure.

```
// this whole line is ignored
#a1b2c3d4 Transformers
  // opens: Inside Transformers
```

## Token semantics

Tokens are how the DSL refers to **existing** nodes without spelling out full ids.

- A token is matched as an **8-character id prefix**. The serializer emits the first
  8 characters of each node's id as its token.
- **Prefix resolution** is scoped to nodes **placed in this graph only**. A `#token`
  resolves to the existing node whose id `startsWith(token)`.
- **Ambiguous prefix** — if a token prefix matches more than one placed node, the
  apply fails with a `PlanError`: `line N: ambiguous anchor #token (matches M nodes)`.
- **Unmatched token** — a `#token` that matches no placed node is treated as a
  **new local alias**. A fresh node is minted, and that alias can be used as an edge
  endpoint within the same source. This is how you create a node and wire an edge to
  it in one pass.
- **The anchor is optional for new nodes.** A header with no `#` simply creates a new
  node (with no alias), so it cannot be an edge endpoint by token.
- A **duplicate anchor** (the same `#token` appearing in two headers) is a parse error.

## Apply semantics

Applying source computes a read-only **plan** (a diff against the current graph),
then executes it as one composite command. The diff has these parts.

### Create / update diffing

- **Creates** — every header that does not resolve to an existing placed node mints a
  new node. New nodes carry their `kind`, `tags`, and `file`/`link` reference, and are
  auto-placed (see [layout](#layout-of-new-nodes)).
- **Updates** — for a header that resolves to an existing node, the engine diffs each
  field: `title`, `summary`, `kind`, `tags`, and the `file`/`link` reference. Only
  changed fields are written. A node whose source matches its current state produces
  no update.
- **Edges** — desired edges are matched against current edges by
  `(fromId, toId, relation)` (relation compared case-insensitively). Desired edges
  not already present are **adds**; current edges not desired are **removes**. An edge
  touching a brand-new (unresolved) endpoint is always an add.

### Vocab auto-ensure

Missing `kind` and relation names are **created inline** during the apply, as part of
the same undo step. Lookup is case-insensitive, so `Paper` and `paper` resolve to the
same kind.

- A missing kind is created with a default color (`#8a8f98`) and icon (`◆`).
- A missing relation type is created with its name.

You never have to pre-declare vocabulary; just use a name and it appears.

### Full-sync deletion

The source is the **complete** description of the graph. A node currently placed in
the graph but **omitted** from the source is removed:

1. Its placement is dropped from this graph, along with **this graph's edges** that
   touch it.
2. If the node is then **placed in no other graph**, it is deleted globally — the
   node record and its files are removed.
3. If the node is still placed elsewhere, only the placement (and this graph's
   touching edges) is dropped; the node survives.

::: warning Omission means deletion
Deleting a node is just leaving it out of the source. Because this can remove data
globally, a destructive apply writes a snapshot first (see
[the apply flow](#dry-run-confirm-apply)).
:::

### Content vs references

The DSL moves references, never bodies:

- Switching `file:` to `link:` (or vice versa) **swaps the reference**.
- Changing **only the filename** on a node that already has a file **renames in
  place** and **preserves the file's content**.
- A brand-new `file:` reference creates a file with **empty content** (`''`). Fill it
  in from the document view afterward.

## Error semantics

Errors surface at two stages.

### Parse errors (400)

A parse error returns HTTP 400 with `{ ok: false, errors: [{ line, message }] }`.
Each message is prefixed `line N: ...`. Causes:

| Cause | Message |
| --- | --- |
| Node header with empty title | `line N: node has no title` |
| `file` and `link` on the same node | `line N: node has both file and link` |
| `file:` with empty value | `line N: file key has no filename` |
| `link:` with empty value | `line N: link key has no url` |
| Same `#token` in two headers | `line N: duplicate anchor #token` |
| Line with `->` that doesn't match the edge regex | `line N: malformed edge (expected "#from -> #to : relation")` |
| Edge with empty relation | `line N: edge has no relation` |

If there are any parse errors, the plan is **not** computed and the graph is not
touched.

### Plan-time errors (400)

After a clean parse, planning can throw a `PlanError`, returned as HTTP 400
`{ ok: false, error }`. The main case is an **ambiguous anchor**:
`line N: ambiguous anchor #token (matches M nodes)`. An edge whose resolved endpoint
cannot be found throws `line N: edge endpoint not found (#from -> #to)`.

### Dry-run, confirm, apply

The editor flow is **plan, then apply**:

1. **Dry run.** `POST /api/graph/:id/source` with `{ source, dryRun: true }` returns
   `{ ok: true, summary }` — the counts the apply *would* produce — without writing.
2. **Apply.** The same request with `dryRun` omitted (or false) executes the plan.
3. **Pre-apply snapshot.** If the plan removes any nodes, the server writes a full
   workspace snapshot **before** applying. If that snapshot fails, the apply is
   **refused** with HTTP 500 and the graph is left unchanged. Retry once snapshots
   can be written.

The summary is a `PlanSummary`:

```ts
{
  creates: number          // new nodes
  updates: number          // existing nodes with a changed field
  edgeAdds: number         // edges to create
  edgeRemoves: number      // edges to delete (dropped + removed-with-node)
  placementsRemoved: number // placements dropped via full-sync omission
  nodesDeleted: number     // nodes deleted globally (unplaced everywhere)
}
```

### Layout of new nodes

New nodes have no coordinates in the DSL. They are laid out on a deterministic grid
**below the existing bounding box**: 4 columns, 220px column width, 140px row height,
80px gap below the current nodes. Order is keyed on the node's index among the new
arrivals, so the same source always lands the same way.

## Worked examples

The summaries below are what a dry run reports (and what the apply produces).

### 1. Author a fresh graph

An empty graph. Declare two new nodes with no anchors.

**Source in**

```
Transformers
  kind: concept
  tags: ml, attention
  file: transformers.md

Attention Is All You Need
  kind: paper
  link: https://arxiv.org/abs/1706.03762
```

**Summary**

| field | value |
| --- | --- |
| creates | 2 |
| updates | 0 |
| edgeAdds | 0 |
| edgeRemoves | 0 |
| placementsRemoved | 0 |
| nodesDeleted | 0 |

Two nodes are minted (one file-backed with empty content, one link), `concept` and
`paper` kinds are auto-created if absent, and both are placed on the grid.

### 2. Add a typed edge and a new kind

Both nodes now exist and resolve by their 8-char tokens. Add an edge with a relation
that doesn't exist yet, and give the second node a kind that doesn't exist yet.

**Source in**

```
#a1b2c3d4 Transformers
  kind: concept
  tags: ml, attention
  file: transformers.md

#e5f6a7b8 Attention Is All You Need
  kind: landmark-paper
  link: https://arxiv.org/abs/1706.03762

#a1b2c3d4 -> #e5f6a7b8 : builds on
```

**Summary**

| field | value |
| --- | --- |
| creates | 0 |
| updates | 1 |
| edgeAdds | 1 |
| edgeRemoves | 0 |
| placementsRemoved | 0 |
| nodesDeleted | 0 |

The `landmark-paper` kind and the `builds on` relation type are created inline. The
second node's kind change is the single update; the new edge is the single add.

### 3. Rename a file vs swap to a link

Start from a node whose `file:` is `transformers.md` with real content.

**Rename in place (content preserved).** Change only the filename:

```
#a1b2c3d4 Transformers
  kind: concept
  file: attention.md
```

**Summary**

| field | value |
| --- | --- |
| creates | 0 |
| updates | 1 |
| (all other fields) | 0 |

The file is renamed to `attention.md` and **keeps its content** — this is a rename in
place, not a new file.

**Swap to a link (reference switched).** Replace the `file:` line with a `link:`:

```
#a1b2c3d4 Transformers
  kind: concept
  link: https://example.com/transformers
```

**Summary**

| field | value |
| --- | --- |
| creates | 0 |
| updates | 1 |
| (all other fields) | 0 |

The payload reference switches from file to link. The DSL never copies the file body
into the link or vice versa — only the reference moves.

### 4. Delete by omission

A graph with three placed nodes — `Keep`, `DropAll`, `DropLocal` — and an edge from
`Keep` to `DropAll`. `DropLocal` is also placed in another graph; `DropAll` is not.
Apply source that mentions only `Keep`:

**Source in**

```
#11112222 Keep
```

**Summary**

| field | value |
| --- | --- |
| creates | 0 |
| updates | 0 |
| edgeAdds | 0 |
| edgeRemoves | 1 |
| placementsRemoved | 2 |
| nodesDeleted | 1 |

- `DropAll` and `DropLocal` placements are both dropped (`placementsRemoved: 2`).
- The `Keep → DropAll` edge goes with `DropAll` (`edgeRemoves: 1`).
- `DropAll` is unplaced everywhere, so it (and its file) is deleted globally
  (`nodesDeleted: 1`).
- `DropLocal` is still placed in the other graph, so only its placement here drops —
  the node survives, and it is not counted in `nodesDeleted`.

Because this plan removes nodes, the server snapshots the workspace before applying.
