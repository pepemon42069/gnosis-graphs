# Using the canvas

The app is a graph workspace: nodes live on a canvas, edges relate them, and any
node can open a **child graph** so a workspace nests as deep as you need. This
page walks through the views, the canvas gestures, and the surrounding chrome.

## Three views, one content area

The content area swaps between three views, picked in priority order. They map
one-to-one to hash routes, so every view is a real URL you can deep-link or
reload into.

| View              | Hash route          | What it shows |
| ----------------- | ------------------- | ------------- |
| **Canvas**        | `#/g/<id>`          | A graph's nodes and edges, laid out spatially. The default view. |
| **Source (DSL)**  | `#/g/<id>/source`   | The same graph as editable canonical DSL text — edit the whole graph as source. |
| **Doc page**      | `#/d/<nodeId>`      | One node's content full-screen, in a focused editor. |

When source mode or a doc route is active it replaces the canvas; closing it
returns you to the graph. Reloads are safe — the route is restored from the URL
and saved navigation state.

### Switching views

- **Canvas → Doc:** double-click a node, press **Enter** on a single selected
  node, or use **Open in editor** in the side panel.
- **Canvas → Source:** click **Edit as source** (`⟨⟩`) in the top bar.
- **Back to the canvas:** the **‹ &lt;graph name&gt;** back button in the doc /
  source header, **Escape**, or **Mod+Shift+,**.

## The canvas

### Creating nodes

- **Double-click empty canvas** opens the node picker at that point. Search an
  existing node to place it, or type a name and choose **Create** to mint a new
  one.
- **Right-click empty canvas** offers the same **Add node…** action through a
  context menu.

New nodes from a source apply land on a deterministic grid below the existing
graph; nodes you create on the canvas land where you clicked.

### Drawing edges

Edges are a **two-stage gesture** with a relation-type step:

1. Drag from a node's handle.
2. Drop on another node → the **relation-type picker** opens. Pick an existing
   relation type or create a new one; the edge commits with that relation.

Dropping on **empty canvas** instead opens the node picker first (create-or-pick
the other end), then asks for the relation type. **Double-click an edge** to
re-pick (retype) its relation.

### Level of detail

Below **0.55 zoom** node cards drop to a compact render — title and kind only,
no tags or summary — so large graphs stay readable when zoomed out. Zoom back in
to restore the full card. Cards always show the authored **summary**, never the
node's payload content.

### Tidy (auto-layout)

**Tidy** (in the top bar) opens a small menu with two one-shot auto-layouts (elkjs),
both node-size-aware:

- **Web** — an organic, compact layout (elk `stress` + overlap removal); the best
  default for densely cross-linked concept graphs.
- **Flow** — a left→right hierarchy (elk `layered`) that shows dependency direction.

A whole-graph tidy fits the result to view. With a selection active it scopes to just
the **selected nodes** (a single selected node is a no-op) and stays in place. Either
way it commits as one move, so a single **Mod+Z** restores the exact prior positions.
Graphs created by the [decompose-md](/guide/decomposing-a-document) skill already start
laid out — and **clustered by tag** (related-tag nodes are pulled together at
construction).

### Filter by tag

The **Filter** button (in the top bar) opens a menu of every tag in the current graph.
Select one or more and the canvas shows **only** nodes carrying any of them (edges to
hidden nodes hide too); **Clear** shows everything again. The filter is view-only — it
never changes the graph — and resets when you navigate to another graph.

### Drilling into child graphs

A node can own a **child graph** — its card shows a `▸ <count>` badge. **Drill
in** (double-click, Enter, or **Mod+Shift+.**) navigates into that child graph;
**drill out** (**Mod+Shift+,**) climbs back up. The breadcrumb trail in the top
bar tracks your depth.

## The side panel

Click a node to select it and open the right-docked **side panel** (resizable by
its left edge). It holds the node's metadata and content:

- **Title** — inline; Enter or Escape commits.
- **Summary** — the text shown on the graph card.
- **Kind** — what sort of thing the node is (paper, person, idea…). Manage the
  list of kinds in **Settings → Kinds**.
- **Tags** — free-form labels for grouping and search. Enter adds one; `✕`
  removes.
- **Format** — a **data / link** segment:
  - **data** stores a **file**; a **filename field** appears, and the filename's
    extension picks the format (Markdown, code, or plain text). Renaming the file
    re-detects the format.
  - **link** stores a **URL** and renders a title + domain link card. It never
    fetches anything.
- **Content** — an **edit / preview** switch over the file body (CodeMirror for
  edit). Edits auto-save.
- **Open in editor** — opens the full-page **doc page** for this node.
- **Delete** (`🗑`) — removes the node from **every** graph after a confirm; its
  payload is lost.

Below these, **Appears in** lists the graphs and parent nodes the node shows up
in.

## The doc page

The doc page (`#/d/<nodeId>`) is the same node's content, full-screen and
focused — useful for long-form writing. The header carries a back button, the
title field, and a layout switch that depends on the format:

- **Markdown files** get a **write / split / preview** switch and a formatting
  toolbar (bold, italic, strikethrough, inline code, headings, bullet / numbered
  / task lists, quote, insert link). Toolbar buttons map to standard
  **Mod+B / Mod+I** style shortcuts.
- **Code and plain-text files** get an **edit / preview** switch.
- **Link** nodes show the URL field and link card.

## The sidebar

The left **sidebar** is persistent chrome (collapsible to an icon rail):

- **Graph tree** — the project's graphs nest into subgraphs and nodes, rooted at
  the home graph. The tree unfolds to follow your navigation.
- **Loose ends** — bottom groups that rescue anything orphaned so nothing is
  silently lost:
  - **Unlinked graphs** — graphs no node points at. Link one into the project
    root or delete it.
  - **Unplaced nodes** — nodes on no graph. Place at the project root (`⊕`),
    open (`✏`/click the title), or delete everywhere (`✕`).
- **Files** — a flat, filename-sorted list of every file in the workspace (each
  node's content; the same set mirrored to `/app/files`). Click a file to open its
  node's doc page; the row tracks whichever doc is open.
- **Docs** (`📖`) opens the documentation inside the app (see below).
- **Settings** (`⚙`) opens the settings modal.

## The top bar

Above the content area:

- **Breadcrumbs** (left) — the navigation trail; click any crumb to jump there.
  Long trails collapse to first + `…` + last few. A doc / source view appends its
  own crumb.
- **Search** (`⌕`, or **Mod+K**) — opens the command picker over the whole
  workspace (nodes and graphs).
- **Fit view** (`⛶`) — frames the whole graph (also **Shift+1**).
- **Tidy** (`▦`) — auto-layout, described above.
- **Edit as source** (`⟨⟩`) — opens the DSL source editor for this graph.
- **Export graph** (`⤓`) — downloads the current graph as JSON Canvas.

The canvas-only actions (fit, tidy, source, export) hide while a doc page or the
docs viewer is open.

## The picker (Mod+K and friends)

One palette, three modes, each remounted so its query and cursor reset between
stages:

| Mode             | Opened by                              | Does |
| ---------------- | -------------------------------------- | ---- |
| **command**      | **Mod+K** / top-bar search             | Search nodes and graphs; jump to a result. |
| **node**         | double-click canvas / edge-to-empty    | Search and place an existing node, or create a new one. |
| **relationType** | finishing an edge / double-click edge  | Pick or create the relation type for an edge. |

Arrow keys move the cursor, **Enter** activates, **Escape** cancels.

## Settings

**Settings** (`⚙` in the sidebar) is a modal with five tabs:

| Tab                | Contents |
| ------------------ | -------- |
| **Appearance**     | Theme preference (light / dark) for the app and canvas. |
| **Kinds**          | Manage node kinds — rename, recolor, merge, delete. |
| **Relation types** | Manage edge relation types — rename, recolor, merge, delete. |
| **Storage**        | Explains the server's automatic snapshots. |
| **Data**           | Export / import the workspace bundle, export Markdown notes, and import a Markdown folder as a new graph. |

## Documentation

The **Docs** button (`📖`) in the sidebar opens this documentation inside the app,
as a full-page view (route `#/docs`) embedding the built docs site. Search, the nav
sidebar, and the theme all work; **Back** (or **Escape** / **Mod+Shift+,**) returns
to the canvas. The server serves the built site at `/docs`, so it is available
wherever the app runs (in local dev, run `pnpm docs:build` once first).

## Keyboard shortcuts

| Keys                  | Action |
| --------------------- | ------ |
| **Mod+K**             | Open the command picker (search nodes and graphs). |
| **Mod+Z**             | Undo the last structural change (native undo in text fields / the code editor). |
| **Mod+Shift+Z**       | Redo. |
| **Mod+Shift+.**       | Drill into the single selected node's child graph. |
| **Mod+Shift+,**       | Go up — close the doc / source view, else drill out. |
| **Escape**            | Dismiss, innermost first: doc → source → panel / selection. |
| **Enter**             | Drill into the single selected node (canvas focus). |
| **Delete / Backspace**| Remove selected nodes and edges from the canvas (canvas focus). |
| **Shift+1**           | Fit the graph to view. |

**Mod** is **⌘** on macOS and **Ctrl** elsewhere. Canvas-scoped shortcuts
(Enter, Delete, Shift+1) only fire when focus is on the canvas, never inside a
field or editor.
