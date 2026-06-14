# Build and deploy

gnosis-graphs is a pnpm + ESM project: Vite + React 19 for the client, `tsx`
running the TypeScript server directly, SQLite via `node:sqlite` (built into
Node 24), and Docker for the self-hosted artifact. This page covers the npm
scripts, the headless check harnesses, the container, and the green-gate every
change must pass.

## Scripts

| Script | Command | Purpose |
| --- | --- | --- |
| `pnpm dev` | `vite` | Dev server (HMR). Proxies `/api` to `:8787`. |
| `pnpm build` | `tsc -b && vite build` | Typecheck then production build into `dist/`. |
| `pnpm preview` | `vite preview` | Serve the production client build. |
| `pnpm lint` | `eslint .` | Flat-config ESLint over `**/*.{ts,tsx}` (ignores `dist`). |
| `pnpm test` | `vitest run` | The vitest suite: cascades, invariants, undo, bundle, interop, DSL, store. |
| `pnpm smoke` | `node scripts/smoke.mjs` | Browser gate against a running server. |
| `pnpm server` | `tsx server/main.ts` | Run the self-hosted server (client + API + SSE). |
| `pnpm server:dev` | `tsx watch server/main.ts` | The server with watch/restart. |
| `pnpm docs:dev` | `vitepress dev docs` | Serve these docs with HMR. |
| `pnpm docs:build` | `vitepress build docs` | Build the static docs site. |
| `pnpm docs:preview` | `vitepress preview docs` | Preview the built docs. |

`pnpm build` runs `tsc -b` against the solution-style root `tsconfig.json`, which
references only `tsconfig.app.json` (client) and `tsconfig.node.json` (server +
Vite config) — `docs/` and `scripts/` are outside the program and untouched by
the typecheck. The
server is **not** compiled to JS for deployment: `tsx` runs the TypeScript
sources directly (the project is erasable-syntax-only).

## The three check harnesses

`scripts/` holds three headless checks. They target the running system in
different ways and — importantly — **read their target URL from different
inputs**:

| Script | URL input | Default | What it does |
| --- | --- | --- | --- |
| `server-check.mjs` | env `BASE` | `http://localhost:8788` | Headless API check: drives `/api/command`, `/undo`, `/redo`, `/export`, etc. over `fetch` — no browser. Asserts the command/undo/cascade/search/export contract, then rewinds every mutation it made. |
| `live-check.mjs` | env `URL` | `http://localhost:5173` | Playwright check of the cutover **client** booting against the server (via the Vite dev proxy): canvas renders, a node can be created through the picker, the side panel opens, no console errors. Rewinds via `/api/undo`. |
| `smoke.mjs` | `argv[2]` | `http://localhost:8787` | The full browser smoke gate (project-spec §11) against `pnpm server` — reads workspace state straight off `GET /api/export` rather than browser storage. |

Mind the difference: `BASE` for the API check, `URL` for the live client check,
and a positional `argv` for smoke. They also default to different ports
(`8788` / `5173` / `8787`), so set the input explicitly when pointing a check at
a non-default server.

Both `server-check.mjs` and `live-check.mjs` rewind every mutation they make (a
loop of `POST /api/undo` until `canUndo` is false) so the next script on a shared
server starts from the pristine seed — the seed itself is not on the undo stack.

## Docker

The container is a single Node process serving the built SPA, the API, and SSE,
backed by SQLite and the host filesystem.

```dockerfile
FROM node:24-slim
WORKDIR /app
RUN corepack enable
# Deps first for layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
# Build the client (dist/) and the docs site — the server serves both.
COPY . .
RUN pnpm build
RUN pnpm docs:build
ENV PORT=8787
ENV GNOSIS_DB=/app/data/gnosis.db
ENV GNOSIS_STATIC=/app/dist
ENV GNOSIS_DOCS=/app/docs/.vitepress/dist
EXPOSE 8787
CMD ["pnpm", "server"]   # tsx server/main.ts
```

The built VitePress site is **static** — the same Node process serves it at `/docs`
(no second server), and the in-app docs viewer embeds it in an iframe. `base: '/docs/'`
in the VitePress config makes its assets resolve under that path. In local dev
(`pnpm dev` + `pnpm server`), `/docs` serves only after `pnpm docs:build` has run once
(Vite proxies `/docs` to the server); otherwise the route 404s.

### Compose volume contract

```yaml
services:
  gnosis:
    build: .
    ports: ['8787:8787']
    volumes:
      - ./data:/app/data           # SQLite database file(s)
      - ./files:/app/files         # workspace file mirror (read-only projection)
      - ./snapshots:/app/snapshots # periodic bundle snapshots
    environment:
      - PORT=8787
      - GNOSIS_DB=/app/data/gnosis.db
      - GNOSIS_STATIC=/app/dist
    restart: unless-stopped
```

Three host directories carry all durable state out of the container:

| Mount | Env var | Holds |
| --- | --- | --- |
| `./data` | `GNOSIS_DB` | The SQLite database. With `:memory:` (the non-Docker default) state is ephemeral. |
| `./files` | `GNOSIS_FILES` (default `./files`) | The one-way DB → FS mirror of the `files` table. |
| `./snapshots` | `GNOSIS_SNAPSHOTS` (default `./snapshots`) | Full-bundle snapshots, pruned to the 50 most recent. |

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `GNOSIS_DB` | `:memory:` (Docker sets `/app/data/gnosis.db`) | SQLite path. If not `:memory:`, the server `mkdirSync`s its dirname recursively at boot. |
| `PORT` | `8787` | HTTP listen port. |
| `GNOSIS_STATIC` | `./dist` (Docker sets `/app/dist`) | Root dir the server serves the built SPA from. |
| `GNOSIS_DOCS` | `./docs/.vitepress/dist` (Docker sets `/app/docs/.vitepress/dist`) | Root dir the server serves the built docs site from, under `/docs`. |
| `GNOSIS_SNAPSHOTS` | `./snapshots` | Snapshot directory. |
| `GNOSIS_FILES` | `./files` | File-mirror directory. |

## The green gate

A change is ready when, in order:

1. **`pnpm lint`** is clean.
2. **`pnpm build`** passes (typecheck `tsc -b` + Vite build into `dist/`).
3. **`pnpm test`** is green (the data-layer vitest suite).
4. **`pnpm server`** boots, then **`pnpm smoke`** passes against it (the browser
   gate — pass the URL as `argv` if the server isn't on `:8787`).
5. **`pnpm docs:build`** succeeds when documentation changed.

The headless API check (`BASE=… node scripts/server-check.mjs`) and the live
client check (`URL=… node scripts/live-check.mjs`) are the targeted harnesses for
verifying the server contract and the cutover client respectively; run the one
that matches what you touched.
