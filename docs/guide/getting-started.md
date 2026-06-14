# Getting started

Gnosis Graphs is a single-user, self-hosted app: one HTTP server owns a SQLite
database and serves the built single-page app from the same origin. There is no
separate database service to run — point the server at a file and it persists
everything there.

This page covers two ways to run it: **Docker Compose** (the turnkey path) and
**local pnpm** (for development or a prod-like local build).

## Path A — Docker Compose

The repo ships a `Dockerfile` and a `docker-compose.yml`. The image builds the
SPA (`pnpm build` → `dist/`) and runs the server with `pnpm server`.

```bash
docker compose up --build
```

Then open <http://localhost:8787>.

### Volumes

Compose mounts three host directories so your data outlives the container:

| Host path     | Container path    | Holds |
| ------------- | ----------------- | ----- |
| `./data`      | `/app/data`       | The SQLite database file (`gnosis.db`). This is the source of truth. |
| `./files`     | `/app/files`      | A one-way, read-only mirror of the files table — every node's content written out as flat files so external tools can read them. |
| `./snapshots` | `/app/snapshots`  | Timestamped full-workspace JSON snapshots written periodically and before any destructive operation. |

> The `./files` directory is a **projection**, not an input. The server writes
> it; it never reads it back. Edit content inside the app, not in `./files`.

Compose publishes port `8787:8787` and sets `restart: unless-stopped`, so the
server comes back up after a reboot.

## Path B — Local with pnpm

Requires Node and pnpm (this repo uses corepack/pnpm; the server runs TypeScript
directly via `tsx`).

```bash
pnpm install
```

### Development (two processes, HMR)

In dev you run the Vite dev server and the API server side by side. Vite proxies
`/api` to the server (see `vite.config.ts`), so the SPA and the API share an
origin from the browser's point of view.

```bash
pnpm server:dev   # API server on :8787 (tsx watch, restarts on change)
pnpm dev          # Vite dev server with HMR — open this URL
```

Open the URL Vite prints (typically <http://localhost:5173>). Requests to `/api`
are forwarded to `:8787`.

### Prod-like (one process)

Build the SPA, then let the server serve the static bundle itself. The server
serves `GNOSIS_STATIC` (default `./dist`) and falls back to `index.html` for
client-side routes, so there is no Vite process in this mode.

```bash
pnpm build        # tsc -b + vite build → dist/
pnpm server       # serves the API and the built SPA on :8787
```

Open <http://localhost:8787>.

## Environment variables

All optional. Defaults below are the in-repo defaults; the Dockerfile and Compose
file override `GNOSIS_DB` and `GNOSIS_STATIC` to absolute container paths.

| Variable          | Default                | Purpose |
| ----------------- | ---------------------- | ------- |
| `GNOSIS_DB`       | `:memory:`             | SQLite database path. `:memory:` is **ephemeral** — the workspace is lost when the process exits. Set a file path to persist; the server creates the parent directory at boot. Compose sets `/app/data/gnosis.db`. |
| `PORT`            | `8787`                 | HTTP listen port. |
| `GNOSIS_STATIC`   | `./dist`               | Directory the server serves the built SPA from. Compose sets `/app/dist`. |
| `GNOSIS_SNAPSHOTS`| `./snapshots`          | Directory for periodic full-bundle snapshots. |
| `GNOSIS_FILES`    | `./files`              | Directory for the one-way filesystem mirror of the files table. |

> **Persistence gotcha:** the default `GNOSIS_DB` is `:memory:`. For any run you
> care about, set `GNOSIS_DB` to a file path (Compose already does). Otherwise
> the seed workspace is rebuilt fresh on every start.

## First run

On boot the server:

1. Opens (or creates) the SQLite database at `GNOSIS_DB`, creating its parent
   directory if needed.
2. **Seeds a baseline workspace** if one does not already exist, so you land on a
   usable graph rather than a blank database.
3. Runs a **live v2 → v3 migration** when the stored schema version is older than
   the current one: inline node payloads are folded into file/link references
   before anything else reads them. This is automatic and idempotent.
4. Builds the search index, starts the snapshot timer, and starts the file
   mirror (an initial reconcile writes the current files to `GNOSIS_FILES`).

When it is ready it logs:

```
gnosis server listening on http://localhost:8787 (db: /app/data/gnosis.db)
```

### Where your data lives

- **The database** — `GNOSIS_DB` (`./data/gnosis.db` under Compose). This is the
  authoritative store.
- **File mirror** — `GNOSIS_FILES` (`./files`). Read-only convenience copy.
- **Snapshots** — `GNOSIS_SNAPSHOTS` (`./snapshots`). Recovery copies.

## Backup and restore

Two complementary mechanisms:

- **Manual export / import.** In the app, open **Settings → Data**. *Export* a
  **Workspace bundle** (one JSON file with every graph, node, edge, file, and
  vocabulary entry). *Import* replaces the entire workspace from such a bundle —
  the server writes a snapshot **first**, so a failed snapshot refuses the import
  rather than overwriting your data.
- **Automatic snapshots.** The server writes timestamped bundle snapshots to
  `GNOSIS_SNAPSHOTS` every few minutes while there are changes, and immediately
  after a cascade deletion. It keeps the most recent 50. To restore, import one
  of those JSON files through **Settings → Data → Import**.

The simplest cold backup is to copy the `GNOSIS_DB` file (or, under Compose, the
whole `./data` directory) while the server is stopped.
