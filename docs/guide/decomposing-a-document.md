# Decomposing a document

You can turn a single markdown document into a knowledge graph — one node per
*isolated concept*, each carrying its own markdown content + kind/tags/summary,
linked by *typed, directed* edges. This is driven by the **`decompose-md` Claude
Code skill** (`.claude/skills/decompose-md`): Claude Code reads the document,
works out where the concept boundaries and relationships are, and materializes the
result by calling the server.

It always creates a **brand-new graph**, so it never touches existing data.

## How it works

The skill does the decomposition, then posts it (via `scripts/decompose-post.mjs`) to
the [`/api/decompose`](/architecture/api-reference#post-api-decompose) route. That is one
composite — one undo step — that creates:

- a new graph, **auto-laid-out** so it starts legible (the organic *Web* layout by
  default; pass `layout: "flow"` for a hierarchy, or re-run the in-app **Tidy** menu
  anytime),
- one node per concept, each with a markdown file holding that concept's text, plus
  its `kind`, `tags`, and `summary`,
- any missing kinds / relation types (reused case-insensitively when they already
  exist), and
- the typed directed edges between concepts.

The new graph shows up live in any open tab (via the SSE stream) and opens at
`#/g/<graphId>`.

## Using it

With the server running (Docker Compose or `pnpm server`, default
<http://localhost:8787>), ask Claude Code to decompose a local markdown file —
for example: *"decompose `notes/transformers.md` into a graph."* The skill will:

1. confirm the server is reachable and read the existing vocabulary
   (`GET /api/vocab`) so it reuses your kinds and relation types,
2. split the document into concepts and infer their relationships,
3. post the payload with `node scripts/decompose-post.mjs`, and
4. report the new graph's id, the node/edge counts, and how to undo it.

## Undo

The whole decomposition is a single undo step. To revert it:

```bash
curl -X POST http://localhost:8787/api/undo
```

Nothing else in the workspace is affected — the command only ever creates.

## What makes a good decomposition

The skill aims for nodes that each stand on their own:

- **Concepts, not headings.** A heading is a hint, not a rule — a section bundling
  several independent ideas becomes several nodes; a heading that just labels one
  idea is merged with it.
- **Self-contained content.** Each node holds the prose for *its* concept, not a
  copy of the whole document.
- **Relations the text supports.** Edges are typed and directed (`defines`,
  `depends-on`, `part-of`, `example-of`, `supports`, `contradicts`, `cites`, …),
  and only asserted where the document actually backs them.
