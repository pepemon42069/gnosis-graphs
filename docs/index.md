---
layout: home

hero:
  name: gnosis-graphs
  text: A self-hosted graph workspace
  tagline: Author a knowledge graph on a canvas or as a per-graph DSL, backed by a single SQLite-and-filesystem server you fully own.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Architecture
      link: /architecture/overview

features:
  - title: Self-hosted SQLite + filesystem
    details: One Hono server on @hono/node-server, backed by a SQLite database file. Bundle snapshots and a one-way file mirror project your workspace onto the filesystem so external tools can read it.
  - title: File & link payloads
    details: Node content never lives inline. Each node carries a file reference (content in the files table) or a link, keeping the graph structure and the content cleanly separated.
  - title: Per-graph DSL
    details: Every graph serializes to canonical DSL text at #/g/<id>/source. Edit the text, plan a dry run, then apply it as a single undoable step — vocab is auto-ensured inline.
  - title: Canvas authoring
    details: A React Flow canvas with drill-in/out, an elkjs-powered Tidy layout, level-of-detail rendering, a command palette, and keyboard-first editing.
  - title: Undo/redo command model
    details: Every write is a Command on a serialized write chain. Undo and redo replay sub-commands in order, so even a whole DSL apply collapses into one reversible step.
  - title: Bundle export & import
    details: Export the entire workspace as a versioned bundle and re-import it to replace state. Destructive operations snapshot first and refuse to proceed if the snapshot fails.
---
