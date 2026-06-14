# Why gnosis-graphs

gnosis-graphs and tools like **Obsidian**, **Logseq**, and **Tana** look similar —
they all show a graph of connected notes — but they sit in different categories.

> **Obsidian is notes-first.** You write markdown files; the graph is a
> *visualization* of the `[[wikilinks]]` inside them — emergent and read-mostly.
>
> **Logseq is outliner-first.** You write bullets in Markdown/Org files; the graph
> visualizes the page and block links between them — emergent, like Obsidian.
>
> **Tana is outliner-first too, but typed.** Its *supertags* turn outline nodes into
> structured entities with fields — the closest model to ours — yet you author an
> outline in a proprietary cloud, not a spatial graph on your own server.
>
> **gnosis-graphs is graph-first.** The typed graph *is* the object you edit;
> notes are payloads hanging off nodes.

That one difference drives everything below.

## At a glance

| Capability | gnosis-graphs | Obsidian | Logseq | Tana |
| --- | --- | --- | --- | --- |
| **Core model** | ✅ Graph-first — typed entities + relations are the thing you edit | Notes-first — a view of `[[links]]` | Outliner-first — a view of page/block links | Outliner-first — typed nodes, authored as an outline |
| **Relationships** | ✅ Typed, **named, directed, colored** edges (reverse / retype / delete on the canvas) | Untyped, directionless wikilinks | Untyped links + block refs | Fields & references, but no spatial directed edges |
| **Nodes** | ✅ Reusable **entities placed in many graphs**, each with its own position | One note = one file at one path | Pages/blocks, reused via refs | Nodes reused via references |
| **Nesting** | ✅ **Subgraphs** — drill into a node's child graph | Flat canvas; no node-as-subgraph | Outline nesting; no spatial subgraph | Outline nesting; no spatial subgraph |
| **Node types** | ✅ First-class **kinds** with color | Tags / frontmatter conventions | Tags / page properties | ✅ **Supertags** carry typed *fields* (richer than ours) |
| **Structure as text** | ✅ Per-graph **DSL** with full-sync — diffable, scriptable, reconciled | No canonical text form of the graph | Markdown/Org files (content, not graph shape) | No exportable text form; proprietary cloud |
| **Data integrity** | ✅ SQLite + **transactional command/undo** with cascades | Plain files; consistency is manual | Files (+ a local DB); consistency is manual | Managed cloud database |
| **Editing surface** | ✅ **Canvas-first** spatial editing + auto-layout | Editor-first; graph is read-mostly | Outliner-first; graph is read-mostly | Outliner-first |
| **Sync** | ✅ Self-hosted server, **live multi-client** over SSE | Local-first; multi-device via file sync | Local-first; file / Git sync | Hosted cloud, real-time multiplayer |
| **Content storage** | Markdown mirrored to disk — keep the plain-file benefit | Markdown files (native) | Markdown/Org files (native) | Proprietary cloud — no plain files |

## What that buys you

- **You model a domain, not just notes.** `Decision —depends on→ Constraint`
  is a real, directed, typed relationship — not a bare link you have to
  interpret later.
- **Entities live above the file tree.** The same node can appear in many
  graphs with different positions, so structure isn't trapped in folders.
- **The graph has a source of truth.** A SQLite-backed server with
  transactional undo keeps the structure consistent, and the per-graph DSL
  gives you a text form you can diff, review, and script.
- **It's a shared, live workspace.** One self-hosted origin streams changes to
  every client in real time — while your content stays as real markdown on disk.

## Where they lead

Worth being honest — each of these is more mature and wins on things we don't do:

- **Obsidian** — a huge **plugin ecosystem** and **mobile apps**, a far more
  polished **markdown editor** and theming, true **offline-first ownership** of a
  plain-files vault, and years of **community** and battle-testing.
- **Logseq** — **open-source**, a local plain-file vault you fully own, a powerful
  **outliner** with block references, offline use, and mobile apps.
- **Tana** — **richer typed entities**: supertags carry structured fields and
  queries, plus **AI-native** features and **real-time collaboration** in a mature
  outliner.

gnosis-graphs is young, self-hosted, and single-purpose by comparison.

## Which to choose

- **Choose gnosis-graphs** when your mental model is *entities and typed
  relationships you actively model* — decisions, dependencies, constraints, a
  domain you reason about structurally — and you want it self-hosted with content
  staying as plain markdown on disk.
- **Choose Obsidian** when your model is *"write notes, discover connections
  later"* and you want a mature, plugin-rich PKM over a plain-files vault.
- **Choose Logseq** when you think in *bullets and outlines* and want local
  plain-text files with powerful block references.
- **Choose Tana** when you want *typed supertags with fields, queries, and AI* in a
  hosted, collaborative outliner — and don't need self-hosting or plain-file ownership.

The middle ground you don't have to give up: content here stays plain markdown
on disk, so the typed graph doesn't cost you file ownership.
