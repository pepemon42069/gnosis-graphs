# Gnosis Graphs

A single-user, self-hosted graph workspace. Nodes live on a spatial canvas,
edges relate them, and any node can open a nested child graph — so a workspace
nests as deep as you need. One HTTP server owns a SQLite database and serves the
built single-page app from the same origin; there is no separate database
service to run. Content can be authored on the canvas, in a full-page editor, or
as a canonical DSL you edit per graph.

## Quickstart (Docker)

```bash
docker compose up --build
# then open http://localhost:8787
```

Compose persists your data to three host directories: `./data` (the SQLite
database), `./files` (a read-only mirror of node content), and `./snapshots`
(periodic backup bundles).

## Requirements

- **Node 24+** for the local (non-Docker) path — the server uses the built-in
  `node:sqlite` module. **pnpm** for scripts. The Docker image pins Node 24.
- A modern, evergreen browser (the SPA is built to an ES2023 target).

## Status & caveats

Young and self-hosted — useful, but **not production-hardened**. Before you run it,
know:

- **No authentication.** It's single-user with no accounts or access control:
  anyone who can reach the server has full read/write. Don't expose it to an
  untrusted network. (Single-*user*, but multiple browser tabs/clients stay
  **live-synced** over SSE — that's the "multi-client" you'll see referenced.)
- **Persistence is opt-in locally.** The default `GNOSIS_DB` is `:memory:`
  (ephemeral); set `GNOSIS_DB` to a file path or the workspace is rebuilt fresh on
  every start. Docker Compose already sets it.
- **The DSL is full-sync.** A graph's source is the *complete* description of that
  graph — omitting a node from the source **deletes** it (a backup snapshot is
  written first). Powerful, but worth knowing before you edit source.

## Commands

| Command          | Purpose |
| ---------------- | ------- |
| `pnpm dev`       | Start the Vite dev server (HMR). |
| `pnpm build`     | Typecheck (`tsc -b`) + production build. |
| `pnpm preview`   | Serve the Vite production build. |
| `pnpm server`    | Run the self-hosted server (API + SSE + serves `dist/`). |
| `pnpm server:dev`| Run the server with `tsx watch` (restarts on change). |
| `pnpm lint`      | Run ESLint. |
| `pnpm test`      | Run the vitest suite (data layer: cascades, invariants, undo, bundle, interop). |
| `pnpm smoke`     | Browser gate against a running server (`pnpm smoke [url]`, defaults to :8787). |
| `pnpm docs:dev`  | Run the VitePress docs site locally. |

For development with HMR, run `pnpm server:dev` and `pnpm dev` together — Vite
proxies `/api` to the server. See the getting-started guide for the full setup.

## Documentation

- [Why gnosis-graphs](docs/guide/why-gnosis-graphs.md) — how it compares to
  Obsidian, Logseq, and Tana, and when to choose it.
- [Getting started](docs/guide/getting-started.md) — install and run (Docker or
  local pnpm), environment variables, first run, backup and restore.
- [Using the canvas](docs/guide/using-the-canvas.md) — the three views and hash
  routes, canvas gestures, side panel, doc page, sidebar, top bar, picker,
  settings, and keyboard shortcuts.
- [DSL reference](docs/guide/dsl-reference.md) — the per-graph source language.
- [Architecture](docs/architecture/overview.md) — how the server, data layer, and client
  fit together.

## Contributing

Coding guidelines live in [CLAUDE.md](CLAUDE.md) — read it before making changes.
