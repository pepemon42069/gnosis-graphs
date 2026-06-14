# gnosis-graphs

Graph-focused web app built with Vite, React 19, and TypeScript. Managed with pnpm.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the dev server (HMR) |
| `pnpm build` | Typecheck (`tsc -b`) + production build |
| `pnpm preview` | Serve the production build statically on :4173 (no API/data — the live origin is `pnpm server` on :8787) |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run the vitest suite (data layer: cascades, invariants, undo, bundle, interop) |
| `pnpm smoke` | Browser gate against a running server (`pnpm smoke [url]`, defaults to :8787) |
| `pnpm server` | Run the self-hosted server (`tsx server/main.ts`) — serves the API + built SPA + docs |
| `pnpm server:dev` | Run the server in watch mode (`tsx watch server/main.ts`) |
| `pnpm docs:build` | Build the VitePress docs site (served at `/docs`) |
| `pnpm docs:dev` | Serve the docs site with HMR |

## Architecture orientation

Self-hosted stack: a Node 24 + `node:sqlite` + Hono server in `server/` drives
the command layer in `src/data/`, and the React SPA in `src/` talks to it over
HTTP + SSE via `src/data/client.ts`.

- **File model.** A node's payload is a `file`/`link` reference; content lives in
  the `files` table, mirrored read-only to `/app/files`.
- **Command/undo.** Every mutation is a `Command` with `do`/`undo`; one DSL apply
  = one composite command = one undo step; writes serialize through `registry.ts`.
- **DSL.** Per-graph text in `src/data/source/`, full-sync semantics (a node
  omitted from the source is removed from the graph).

See `docs/` for the full docs site (and `docs/guide/dsl-reference` for the DSL).

## Coding guidelines

1. **Lean code.** Write the least code that fully solves the problem. Delete dead
   code, unused props, and speculative options. Prefer a direct solution over a
   clever or generalized one until a second real use case exists.
2. **Short files.** Keep files small and single-purpose. If a file grows past
   ~150–200 lines or starts mixing concerns, split it. Default to one component,
   hook, or utility per file.
3. **Modularity.** Compose small, focused units with clear inputs and outputs.
   Keep components presentational and push logic into hooks/utilities. Depend on
   narrow interfaces, not on the internals of other modules.

Supporting practices:

- Match the style, naming, and patterns of the surrounding code.
- Name things for what they do; skip abbreviations and filler comments.
- Avoid premature abstraction — duplicate twice before extracting a shared helper.
- Keep modules side-effect-free at import time; do work in functions, not at the
  top level.
- **Atomicity.** Keep `do`/`undo` exact inverses. Never call
  `ensureKind`/`ensureRelationType` inside a composite apply (they open their own
  txn + push their own undo step) — create vocab inline.
- **Language-data layering.** The pure DSL/parse layer must not import
  `@codemirror/language-data` or touch the DB.
