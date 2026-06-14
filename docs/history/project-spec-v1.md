> **HISTORICAL — archived.** This is the original v1 project spec. It predates
> the self-hosted re-platform (Phases 0–2: SQLite + Hono server, a payload →
> file/link reference model, and graphs authorable as a DSL). It no longer
> describes how the app is built or run. The current source of truth is the docs
> site — start at [Architecture overview](/architecture/overview) and
> [Getting started](/guide/getting-started). This file is kept for history: the
> §10 decision log, §11 milestones, and §12 deferred ideas.

# gnosis-graphs — project spec

A personal, local-first tool for organizing thought as knowledge graphs.
Single user, browser-based, built on the existing Vite + React 19 + TypeScript
scaffold. This document is the source of truth for what v1 is — and is not.

## 1. Purpose & non-goals

Complicated projects sprawl. Building a commit-reveal protocol means juggling
Poseidon hashes, k-anonymity sets, smart-contract implementations, state
machines, literature, and philosophical framing — related ideas scattered
across notes, files, and memory. gnosis-graphs organizes them as **knowledge
graphs**: topic nodes carrying real content (markdown, plaintext, JSON, links),
connected by directed, typed edges, arranged spatially by hand, and navigable
by drilling into a concept to find its own internal graph.

The bet: manual spatial arrangement plus explicit typed relationships beats
both flat note piles and auto-generated graph views. Your layout *is* your
memory of the material.

**Non-goals for v1** (each rejection is justified in the section it haunts):

- No in-app AI. The export bundle is the AI interface (§9).
- No collaboration, multi-user, or sync backend. Single user, single machine.
- No mobile or touch support. Desktop browser only.
- No hosting/server. Pure static SPA; all data stays in the browser + a local
  folder mirror.
- No global force-directed graph view. Documented to degrade into an unusable
  hairball past ~200 nodes (Obsidian's signature failure).
- No physics or layout that moves nodes on its own. Layout only ever changes
  by explicit user action — the one-click, undoable Tidy command (§5) is
  exactly that, never an automatic behavior.
- No continuous zooming UI (Prezi/Muse-style). A short animated transition on
  drill-in conveys containment at a fraction of the cost.
- No custom fields on node kinds (Tana-style supertags). Kinds are visual
  labels only in v1.

## 2. Core concepts & vocabulary

| Term | Meaning |
| --- | --- |
| **Workspace** | Everything: all nodes, graphs, placements, edges, relation types, kinds. One per browser origin. |
| **Node** | A topic/concept with global identity. Has a title, an optional kind, tags, and one payload. Exists independently of any graph. |
| **Payload** | The node's content. One of four formats: `markdown`, `plaintext`, `json`, or `link` (URL). |
| **Kind** | Optional visual type on a node (e.g. paper, contract, concept). Color + icon, drawn from a small managed list. Never required. |
| **Tag** | Freeform string label on a node. Cheap filtering. |
| **Graph** | A named canvas. Holds placements and edges — never the nodes themselves. |
| **Placement** | "Node N appears in graph G at (x, y)." One node may have placements in many graphs — at most one per graph. |
| **Edge** | A directed, typed connection between two nodes *within one graph*. |
| **Relation type** | A managed, workspace-global edge vocabulary entry (implements, cites, contradicts, …). |
| **Drill-down** | Opening a node's child graph as a new full canvas. Any node may reference one child graph. |
| **Home** | A built-in, undeletable graph-of-graphs. The app's landing canvas. |

The load-bearing design decision: **nodes are global; graphs hold
references.** A "Poseidon hash" node can sit in a *crypto-primitives* graph
and in the *commit-reveal protocol* graph simultaneously — same node, same
payload, two placements. This is what makes multiple graphs over shared
concepts work, and it rules out tree-ownership models (GraphML-style nesting)
where a node belongs to exactly one parent.

A graph is entered the same way everywhere: through a node that references it.
Home is just a graph whose nodes point (via child-graph references) at your
top-level graphs. One drill-in verb, all the way down.

## 3. Data model & invariants

Six record types. IDs are UUIDv4 (`crypto.randomUUID()`). Every record carries
ms-epoch `createdAt`/`updatedAt` (omitted from the table for brevity — moving
a placement updates its timestamp). UUIDs, not content-addressing — identity
must survive constant edits.

| Record | Fields |
| --- | --- |
| `node` | `id`, `title`, `kindId?`, `tags[]`, `payload { format, content }`, `childGraphId?` |
| `graph` | `id`, `name` |
| `placement` | `id`, `graphId`, `nodeId`, `x`, `y` |
| `edge` | `id`, `graphId`, `fromNodeId`, `toNodeId`, `relationTypeId` |
| `relationType` | `id`, `name`, `color?` |
| `kind` | `id`, `name`, `color`, `icon` |

No speculative fields: placements have no size or color (cards auto-size to
content; node color comes from the kind), graphs have no description. The
Dexie migration chain (§8) makes adding fields later trivial.

Edges are **graph-scoped** (quad-style: from, to, type, graph). The same two
concepts may relate differently in different diagrams, and deleting a graph
cleanly removes its edges without touching shared nodes. The "global" view of
a node's relationships is recovered as a query — the side panel aggregates a
node's edges across all graphs by indexing edges on node id (§6).

Seeds: relation types `relates to`, `implements`, `cites`, `contradicts`,
`depends on`, `part of`; kinds `concept`, `paper`, `contract`, `question`,
`decision`. Both lists are fully editable (§5); new entries are creatable
inline at the point of use, so managed vocabulary never becomes capture
friction.

### Invariants

- **At most one placement per (graphId, nodeId)** — dispatcher-enforced.
  Picking a node already placed in the current graph pans to and selects its
  existing placement instead of creating a duplicate.
- `relationType.name` and `kind.name` are unique case-insensitively; an
  inline create that matches an existing name selects it instead of
  duplicating.
- `node.title` is non-empty; a blank edit reverts.
- `graph.name` may collide — identity is the id.

### Deletion cascade matrix

Every destructive operation goes through the command dispatcher (§8) and is
undoable in-session.

| Operation | Removes | Survives |
| --- | --- | --- |
| Remove placement (canvas `Delete`) | That placement + edges in that graph touching that node | The node, its payload, all other placements |
| Delete edge (canvas `Delete`) | That edge only | Both endpoint nodes and their placements |
| Delete node (side panel, explicit) | The node + all its placements + all edges touching it, in every graph | Its child graph, if any (may become unreferenced) |
| Delete graph | The graph + all its placements + all its edges; clears `childGraphId` on every node that referenced it | All nodes that were placed in it |
| Delete relation type | Only allowed when unused; if in use, the UI requires merging it into another type (re-pointing its edges) first | — |
| Delete kind | Only allowed when unused; if in use, merge into another kind (re-pointing its nodes) first | — |

Deleting Home is refused. Graphs are deleted from a canvas-level menu while
viewing them, or from the loose-ends list on Home; afterwards the view jumps
to the parent breadcrumb segment, falling back to Home.

### Cycles, loose ends, integrity

- **Containment cycles are allowed.** A node in graph A may open graph B,
  which contains a node opening graph A. Breadcrumbs render the traversal
  path actually taken (not a computed canonical path) and collapse the middle
  beyond 6 segments (`Home › … › State machines`).
- **Loose ends surface on Home**, in a collapsible section: *unreferenced
  graphs* (no node points at them via `childGraphId`) and *unplaced nodes*
  (zero placements). Each can be re-linked/re-placed or deleted from there.
- IndexedDB has no foreign keys: every cascade above runs in a single Dexie
  transaction. Dangling placements/edges are a bug class the dispatcher must
  make impossible.
- The workspace carries a `schemaVersion` (in a `meta` table). Migrations use
  Dexie's `version().upgrade()` chain. Imported bundles older than current are
  migrated through the same chain; bundles newer than the app are refused with
  a clear message — never partially imported.

## 4. Navigation model

The navigation story in one paragraph: *single-click selects a node and opens
its content in the side panel; double-click (or Enter) drills into the node's
child graph as a new full canvas with a brief zoom transition; the breadcrumb
bar always shows where you are; back/forward walks where you've been; Mod+K
teleports anywhere; Home is the map.*

- **Drill-in.** Double-click (or `Enter` on selection) on a node with a child
  graph opens it. On a node without one, the same gesture offers a confirm —
  "Create sub-graph 'Poseidon hashes'?" — `Enter` confirms, `Escape` cancels,
  with buttons for mouse users. Sub-graphs are cheap but never accidental.
  Nodes with child graphs show a count badge (§5).
- **Drill-out.** `Mod+Shift+,` or clicking the parent breadcrumb returns to
  the parent graph in the trail; when the trail has no parent (a root graph,
  or right after a lateral jump), drill-out goes to Home.
- **Breadcrumbs** (structural position) and **history** (temporal position)
  are distinct and both required: breadcrumbs cannot represent lateral jumps
  (following search results or cross-graph edges). After a lateral jump the
  trail resets to just the current graph; subsequent drill-ins extend it from
  there. Each canvas visit pushes a History API entry carrying the trail, so
  the browser's own back/forward (buttons, mouse side-buttons, `Alt+←/→` on
  Windows/Linux, `Cmd+←/→` on macOS) and reload all restore navigation state
  natively — the app intercepts none of them.
- **Mod+K** opens global fuzzy search across all nodes and graphs — the
  universal teleport (§7).
- **Home** is the landing canvas: a normal graph (rendered by the same canvas
  component) whose nodes reference top-level graphs, plus the loose-ends
  section (§3).
- **"Appears in" panel.** The side panel lists every graph holding a placement
  of the current node, and every node whose child graph contains it — the
  reverse index that makes drill-out and cross-graph awareness work.
- **Zoom-to-fit** (`Shift+1`) recenters the current canvas; never automatic.

## 5. Canvas interaction

Built on React Flow's tested input handling: wheel zooms at cursor (with the
ctrlKey trackpad-pinch distinction), drag on empty canvas pans, `Shift`+drag
rubber-band selects.

### Event table

| Input | On a node | On an edge | On empty canvas |
| --- | --- | --- | --- |
| Click | Select; open side panel | Select; show relation type | Clear selection; close panel |
| Double-click | Drill in (or offer sub-graph creation) | Open relation-type picker | Open node picker; create/link node at cursor |
| `Enter` | Drill into selected node | — | Confirm picker selection |
| `Escape` | Dismiss picker / close panel / clear selection (innermost first) | same | same |
| `Delete` | Remove placement (the node survives — §3) | Delete edge | — |
| Drag from node handle | Start edge; drop on node → relation-type picker; drop on empty → node picker, then relation-type picker | — | — |
| Mouse back/forward | History navigation — global, independent of hover target | same | same |

### Keyboard map

The canonical shortcut list. `Mod` = `Ctrl` (Linux/Windows) / `Cmd` (macOS).

Two rules govern the whole map. **Reserved combos**: nothing the browser or
OS claims is bound — `Mod+W/T/N`, and notably `Mod+,` (macOS Preferences) and
`Mod+.` (Safari stop) are avoided; `Mod+K` is interceptable and conventional.
**Focus scoping**: `Enter`, `Delete`, and `Shift+1` are canvas-scoped — they
fire only when the canvas has focus, never while a text input, picker, or the
editor is focused. `Escape` is global (dismissal). `Mod+Z` applies to the
focused surface (§6).

| Shortcut | Action |
| --- | --- |
| `Mod+K` | Global search / teleport / create-from-miss |
| `Mod+Shift+.` | Drill into selected node |
| `Mod+Shift+,` | Drill out to parent graph (Home when no parent) |
| `Alt+←/→` (Win/Linux), `Cmd+←/→` (macOS) | History back / forward — native browser shortcuts, not intercepted |
| `Shift+1` | Zoom to fit |
| `Enter` | Drill into selected node |
| `Delete` | Remove selected placement or edge |
| `Escape` | Dismiss innermost surface (picker → panel → selection) |
| `Mod+Z` / `Mod+Shift+Z` | Undo / redo structural operations |

Reserved for post-v1 (do not repurpose): `Tab` (create child node). Note for
later: keyboard-first sibling creation cannot reuse plain `Enter` (bound to
drill-in) and will need a mode switch.

### Node anatomy

A node renders as a card: kind color strip + icon (when a kind is set), title,
small tag chips, and a child-count badge (e.g. `▸ 12`) when it has a child
graph — drillability must be visible, because the click/double-click split is
the model's main confusion risk. Cards auto-size to content; there is no
manual resize in v1. Semantic level-of-detail: at far zoom only the title and
kind color render; at near zoom a payload excerpt appears. Payload excerpts
are previews, never editors — all editing lives in the side panel.

New nodes spawn at the double-click cursor position, or at viewport center
when created via `Mod+K`, nudged to avoid overlapping an existing placement.

### Edge creation

Drag from a node's handle. Dropping on a node opens the relation-type picker:
an autocomplete over managed types with inline "create type" — `Enter`
accepts the preselected default (`relates to`), so drawing an edge never
demands taxonomy work upfront. Dropping on empty canvas opens the node picker
first (search-or-create, §7), then the relation-type picker.

Cancel semantics: `Escape` at the node-picker stage cancels the whole gesture
(no node, no edge); `Escape` at the relation-type stage discards only the
pending edge — a node just created via the picker survives, with its
placement (capture is sacred, §7). Edges render with an arrowhead at the
target and the relation-type name as label.

Relation types and kinds are managed in one small settings surface: create,
rename, recolor (kinds also: icon), merge-into (re-points all edges/nodes —
used by deletion, §3), and delete (unused entries only, §3).

### Tidy (one-click organize)

A `Tidy` button on the canvas toolbar runs a one-shot elkjs layered layout on
the current graph. Directed typed edges give the algorithm real structure —
`depends on` and `part of` chains become layers — so the result reads as a
diagram, not a physics blob. With a selection active, only the selected nodes
are laid out; everything else stays put. Tidy is a single dispatcher command:
one `Mod+Z` restores the previous hand-made layout exactly. It never runs
automatically — loading, importing, or drilling into a graph never moves a
node (§1). Natural pairing: bulk import, then Tidy.

## 6. Payload editing

A right side panel, resizable, opened by node selection. The canvas is purely
for arranging and connecting; all content — including the title — is edited
here.

- **Header**: title, kind selector (inline create allowed), tag editor, the
  payload-format switcher (`markdown` ⇄ `plaintext` ⇄ `json` ⇄ `link`; raw
  text carries over unchanged, no conversion), the "appears in" list (§4),
  and the explicit "Delete node everywhere" action — deliberately far from
  the canvas `Delete` key.
- **Body**: per-format editor.
  - `markdown` — CodeMirror 6, markdown mode with syntax highlighting.
  - `json` — same CodeMirror instance, JSON mode with lint.
  - `plaintext` — same, plain mode.
  - `link` — URL field plus a simple preview card (title + domain).
- CodeMirror is lazy-loaded (dynamic import) so the canvas bundle stays light.
- Text edits autosave (debounced) and use CodeMirror's own text-level undo.
  The structural undo stack (§8) deliberately excludes keystroke-level text
  changes; `Mod+Z` applies to whichever surface has focus.

## 7. Search & capture

Prior art is unanimous: capture friction kills these tools. Every
*interactive* path to creating a node is search-first and requires zero
classification. (Paste and bulk import are deliberate exceptions — their
duplicates are triaged spatially, with merge-nodes deferred to §12.)

- **Index**: MiniSearch over node title (boosted), tags, payload text, and
  graph names. Built on app load (fine at personal scale — hundreds to low
  thousands of nodes) and updated incrementally from dispatcher events.
- **Mod+K flow**: fuzzy results are nodes (kind icon, title, the graphs they
  appear in) and graphs (open on `Enter`). For a node with placements,
  `Enter` jumps to the placement in the most recently visited graph (session
  recency, falling back to graph `updatedAt`); further results enumerate the
  other placements. A node with zero placements opens its side panel with a
  "place in current graph" action. No hit → the first action is
  `Create "<query>"` — a new `markdown` node lands in the current graph at
  viewport center, picker closes, title already set. Kind and tags are
  assignable later in the side panel, never demanded at capture.
- **Search-first creation everywhere**: the same picker backs double-click on
  empty canvas and edge-drop on empty canvas; picker-created nodes default to
  the `markdown` format. Existing nodes always surface before the create
  action — this is the v1 defense against near-duplicate drift ("Poseidon"
  vs "Poseidon hash"). A merge-nodes operation is explicitly deferred (§12).
- **Paste**: pasting a URL onto the canvas creates a `link` node at the
  cursor, titled with the URL. Pasting text creates a `markdown` node with
  the text as payload, titled with its first non-empty line (truncated to
  80 characters).
- **Bulk import** (v0.3): point at a folder of `.md` files; each becomes a
  markdown node (frontmatter `tags` honored), grid-placed in a new graph to
  be triaged spatially. The tool must start useful, not empty.

## 8. Persistence & data safety

Storage architecture is the hardest thing to change later (see Logseq's
multi-year file→DB rewrite limbo). v1 commits to:

- **Source of truth: IndexedDB via Dexie 4.** Tables: `nodes`, `graphs`,
  `placements`, `edges`, `relationTypes`, `kinds`, `meta`. Indexes:
  placements by `graphId` and by `nodeId`; edges by `graphId`, `fromNodeId`,
  `toNodeId`, and `relationTypeId`; nodes by `childGraphId` (the queries in
  §3/§4/§6 — cross-graph aggregation, "appears in", loose ends, cascades —
  depend on exactly these). `liveQuery` provides reactive React bindings and
  cross-tab consistency.
- **Command dispatcher.** Every structural mutation (create/delete/move
  anything, edge changes, relation-type and kind changes) is a command object
  with `do`/`undo`, executed in a Dexie transaction. This buys: in-session
  undo/redo (stack capped at 100), incremental search-index updates, and a
  single choke point where cascade integrity and invariants (§3) are
  enforced. Payload text changes bypass the stack (§6) but still flow through
  the dispatcher for persistence and indexing.
- **Snapshots.** A full canonical bundle (§9) is written when the workspace
  is dirty: every 5 minutes and after any cascade deletion. Two destinations:
  - **OPFS ring buffer** (always, all browsers): last 20 snapshots.
  - **Folder mirror** (Chromium): the user picks a real directory once via
    the File System Access API; the handle persists in IndexedDB and
    permission is re-requested on launch with a one-click prompt. Snapshots
    are timestamped JSON files, pruned to the last 50. This folder is
    git-able and survives browser-profile wipes. Feature-detected; absence
    (Firefox/Safari) degrades to OPFS + manual export, with a visible notice.
- **Eviction defense**: `navigator.storage.persist()` requested at startup.
  Safari evicts IndexedDB and OPFS after 7 days without interaction — the
  folder mirror and manual export exist precisely because browser storage is
  a cache with delusions of permanence.
- **Origin pinning.** IndexedDB is scoped to scheme://host:port, so the dev
  server (5173) and preview (4173) are *different workspaces*. Daily use
  happens on one canonical origin: `pnpm preview` on its fixed port (or an
  installed PWA of the production build). The dev server is for development,
  with its own throwaway data; moving data between origins is an
  export/import.

## 9. Export & interop

Exit portability is a trust prerequisite, even for a personal tool. Export is
a v0.1-adjacent feature, not polish.

- **Canonical: workspace bundle.** One self-contained JSON file —
  `{ schemaVersion, exportedAt, nodes, graphs, placements, edges,
  relationTypes, kinds, meta: { rootGraphId, homeGraphId } }` (the `meta` ids
  are required for a full replace to restore which graph is Home/undeletable).
  Lossless; doubles as the snapshot format (§8), the
  restore format, and the **AI interface**: drop the bundle into Claude and
  ask questions about your own thinking. This is the deliberate alternative
  to in-app AI. **Import is a full workspace replace** behind an explicit
  confirmation, with an automatic snapshot taken first; merge-import is
  deferred (§12).
- **Interop: JSON Canvas 1.0** (the open `.canvas` spec stewarded by
  Obsidian). Per-graph export: markdown/plaintext payloads → `text` nodes,
  `link` payloads → `link` nodes, JSON payloads → fenced code in `text`
  nodes; titles render as a heading line inside the text. Edges map directly
  (`fromNode`, `toNode`, `label` = relation-type name, `toEnd: "arrow"`).
  Exported nodes carry a fixed default `width`/`height` (the spec requires
  them; placements store none). A node's child graph exports as a sibling
  `.canvas` file: nodes without a payload become a `file` node referencing
  it; nodes with both payload and child graph stay `text` nodes with a
  markdown link to the sibling file appended. Each reachable graph is
  emitted at most once with a stable filename (slug + short id), so
  containment cycles terminate — repeated references point at the
  already-emitted file. Documented as lossy: kinds, tags, payload-format
  distinctions (markdown/plaintext/json all become `text`), cross-graph node
  identity, relation-type identity (labels survive as strings), and
  child-graph linkage (degraded to file references) do not round-trip.
- **Markdown export**: each markdown node as an `.md` file with YAML
  frontmatter (`id`, `title`, `kind`, `tags`) — Obsidian-vault compatible.
- **No GraphML/GEXF.** Their strict-tree nesting semantics conflict with
  node reuse across graphs; exporting them would silently lie about the data
  model.

## 10. Stack & architecture decisions

| Dependency | Why |
| --- | --- |
| `@xyflow/react` 12.x | The canvas. MIT, React 19-compatible, actively maintained. The only mature option where nodes are literal React components — markdown-rich node content with zero friction. Ships pan/zoom/minimap/selection handling. |
| `dexie` 4.x | IndexedDB without tears; `liveQuery` reactive bindings; works in every browser. |
| CodeMirror 6 (`@codemirror/*`) | Side-panel editor; markdown + JSON modes from one lazy-loaded engine. |
| `minisearch` | Right-sized full-text index for hundreds-to-thousands of docs; tiny. |
| `zustand` | UI/session state (selection, navigation stack, panel state) outside React Flow. |
| `react-markdown` | Read-only payload previews (node excerpts, link cards), lazy-rendered. |
| `elkjs` | The Tidy command only (§5); layered algorithm suits directed typed edges; lazy-loaded so the canvas bundle stays light. EPL-2.0 (the one non-MIT dependency). |

React Flow performance rules (mandatory, not advisory — these are the
difference between smooth and janky at hundreds of rich nodes):

- Node payloads never live in React Flow's `node.data`. The flow holds ids
  and positions; content comes from the store, keyed by node id.
- Custom node components are memoized.
- `onlyRenderVisibleElements` is on; node content uses the LOD rule (§5) so
  markdown never renders at far zoom.

Rejected alternatives (one line each, so they stay rejected):

| Alternative | Why not |
| --- | --- |
| AntV G6 v5 | Closest runner-up (built-in combo collapse); 0.x React extension, ~390 KB, v5 API churn. |
| Cytoscape.js | Best-in-class compound nodes, but canvas-rendered — React-in-node only via overlay hacks; React wrapper stale since 2022. |
| Sigma.js / Reagraph / vis-network | WebGL/canvas renderers; cannot render React inside nodes — wrong content model. |
| tldraw | Proprietary license + watermark; no graph/edge model. |
| Reaflow | Stale (last publish 2025-04), ~2.4 MB. |
| dagre | Unmaintained since 2019. |
| React Flow subflow nesting (`parentId`) | Ships with the chosen library, still rejected for containment: degrades past 1–2 levels. Containment is always drill-in to a new canvas (§4), never inline nesting. |
| Graphology | Right idea, wrong time: a second in-memory graph representation is pure sync burden until an analytics surface exists (§12). Dexie indexes cover every v1 traversal. |
| Continuous/automatic layout (force simulation, layout-on-load) | Auto-moving nodes destroy the spatial memory that manual placement builds (§1). elkjs is admitted only behind the explicit, undoable Tidy command (§5). |
| SQLite-WASM | Exclusive-lock/multi-tab complexity buys nothing at personal scale. |
| File System Access as primary store | Chromium-only; Firefox's standards position is negative. Mirror, not source of truth (§8). |

## 11. Milestones

**v0.1 — walking skeleton.** A single root graph, created at first run, is
the landing canvas (Home and the graph map arrive in v0.2; drill-out from the
root is a no-op). Create nodes (search-first picker), draw typed edges, drill
in/out — drill-in creates sub-graphs, so multiple graph records exist —
breadcrumbs, side-panel CodeMirror editing, Dexie persistence through the
dispatcher, manual bundle export/import (full replace). *Proves: the core
loop feels right.*

**v0.2 — daily-usable.** Mod+K across everything, multiple top-level graphs +
Home + the loose-ends list, history integration, undo/redo, snapshots (OPFS +
folder mirror), the relation-type & kind management surface, tags. *Proves:
it can hold the commit-reveal project for real.*

**v0.3 — polish & exits.** JSON Canvas export, markdown export, bulk markdown
import plus the Tidy command (they pair: import, then organize), link-node
preview cards, LOD tuning, keyboard refinement. *Proves: data isn't trapped.*

Each milestone ships usable; nothing in a later milestone is load-bearing for
an earlier one.

## 12. Deferred ideas

Parked, not rejected. Revisit only after v0.3 earns daily use.

- TheBrain-style ego/local view (focus node centered, relatives arranged
  around it) as a second navigation mode — good answer to "show me everything
  about this node across all graphs."
- Graph analytics: orphan detection, under-connected clusters, structural
  gaps (InfraNodus-style) — the point where Graphology enters.
- Merge-nodes operation for duplicate cleanup.
- Merge-import (bundle merge with UUID collision handling) — v1 import is
  replace-only (§9).
- CRDT sync (Yjs or Loro). The schema is deliberately CRDT-convertible: small
  id-keyed records, no order-dependent arrays, timestamps on every record. No
  migration required to add it.
- Semantic zoom beyond two LOD levels; real ZUI camera.
- In-app AI (link suggestions, chat-with-graph) — only if the export-bundle
  workflow proves insufficient.
- Tauri desktop shell if browser storage ever disappoints — the data layer
  ports unchanged.
- Custom fields on kinds (supertag territory).
- Keyboard-first graph editing (`Tab` = child; sibling creation needs a mode
  switch, since `Enter` is drill-in) and split panels.

## 13. Shipped deviations from the v1 spec

§1–§12 describe v1 as originally scoped. The list below records deliberate,
post-spec product decisions taken during implementation (v0.4–v0.5.1). They
supersede the cited passages; the rest of the spec stands. Kept here so the
document remains the source of truth and compliance audits stop re-flagging
intended behavior.

- **Node `summary` field** (supersedes §3 "no speculative fields" and the §5
  "payload excerpt" rule). Nodes carry an optional authored `summary`; the
  canvas card shows *that* at near zoom, never the payload itself — the card is
  a deliberate, hand-written blurb, not a derived excerpt. The summary is
  search-indexed (boosted) and travels in the export bundle.
- **`code` payload format with a `language`** (supersedes the fixed
  `markdown | plaintext | json | link` set in §2/§6). `json` generalized to a
  `code` format carrying a highlight `language`; the panel's content select
  exposes the full CodeMirror language palette, and JSON still lints. The four
  original formats remain reachable — a functional superset.
- **`data | link` format switcher** (supersedes §6's 4-way peer switcher). The
  panel groups payloads into a `data` section (markdown / plaintext / a code
  language, chosen from a sub-select) and a `link` section. Switching still
  carries the raw text over unchanged.
- **"Open in editor" full-page document editor** (supersedes §5/§6 "all editing
  lives in the side panel"). A node's payload can open as a full-page editor
  (`#/d/<nodeId>`) with markdown write/split/preview, code line numbers, and
  search — alongside, not replacing, the side panel. The canvas itself still
  edits nothing.
- **Projects + project-as-root** (extends §4/§8). The workspace is split into
  named projects, each its own origin-scoped database, chosen from a pre-boot
  landing screen; the root graph is named after the active project rather than a
  fixed "Home" label.
- **Navigation remembers each graph's camera** (refines §4 "zoom-to-fit … never
  automatic"). A graph fits to contents only on its first visit in a session;
  every later return restores the camera you left, so navigation never
  auto-fits.
