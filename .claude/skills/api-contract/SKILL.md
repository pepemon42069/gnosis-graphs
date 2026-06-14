---
name: api-contract
description: >
  Cross-checks the HTTP/SSE contract across its three definitions in
  gnosis-graphs: the server routes in server/api.ts, the client string paths in
  src/data/client.ts, and the documented route table in
  docs/architecture/api-reference.md. Also checks the SSE/Broadcast payload shape
  against the client's applyEvents. Use this skill whenever server/api.ts or
  src/data/client.ts changes, when a route is added/renamed/removed, when a
  request or response shape changes, or when the user asks to "check the API
  contract", "do client and server agree", "is the route table accurate", or
  "verify the SSE payload". Reports mismatches with file:line. It reports drift;
  it does not change behavior.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# api-contract

The HTTP + SSE contract lives in three places that must stay in lockstep:

1. **Server** — `server/api.ts` (the real routes + SSE stream).
2. **Client** — `src/data/client.ts` (the `fetch`/`EventSource` calls).
3. **Docs** — `docs/architecture/api-reference.md` (the published route table).

This skill verifies all three agree, plus that the SSE `Broadcast` payload the
server emits matches what the client's `applyEvents` consumes. It is a
read-and-report skill: it reports mismatches with `file:line` and does not change
runtime behavior. (Doc repairs are owned by the `doc-sync` skill.)

## When to use

- `server/api.ts` or `src/data/client.ts` changed.
- A route was added, renamed, removed, or had its method/body/response changed.
- The SSE `Broadcast` / `StoreEvent` shape changed.
- The user asks whether client, server, and docs agree on the API.

## Procedure

### 1. Extract the server's routes

From `server/api.ts`, list every registered route — each
`app.get/post/put/delete/use('<path>', ...)` — capturing method, path,
request-body shape, success response, and error response/status. Include:

- the static + SPA fallback (`app.use('/*', serveStatic(...))` and
  `app.get('/*', serveStatic({ path: ... }))`), and
- the SSE endpoint `app.get('/api/events', ...)` and the `Broadcast` type
  (`type Broadcast = CommandEvent & { canUndo; canRedo }`).

```bash
grep -nE "app\.(get|post|put|delete|use)\(" server/api.ts
```

### 2. Extract the client's paths

From `src/data/client.ts`, list every URL the client builds (the `fetch(...)`
targets and the `new EventSource(...)` URL), with method and the body it sends.

```bash
grep -nE "fetch\(|EventSource|/api/" src/data/client.ts
```

### 3. Extract the documented route table

From `docs/architecture/api-reference.md`, read the route table rows (method,
path, body, response).

### 4. Cross-check the three lists

Report a mismatch for each of:

- **Server route with no client caller** — note it (may be intentional, e.g.
  `/api/can-undo-redo` used only as a fallback); flag, don't assume a bug.
- **Client path with no server route** — a 404 waiting to happen. Mismatch.
- **Method or path divergence** — e.g. client `POST`s where the server only
  `GET`s, or a `:id` param/segment differs.
- **Body / response shape divergence** — the client sends or expects a field the
  server does not produce/consume (e.g. `{ kind, args }` body, the
  `{ ok, result }` vs `{ ok, error }` envelope, the `{ ok, errors }` parse-error
  shape from `/api/graph/:id/source`).
- **Doc row missing, extra, or wrong** — a route in code but not the table, a
  table row with no route, or a row whose method/path/body/response disagrees
  with code.

Each mismatch:

```
<kind of mismatch> — server/api.ts:<line> ↔ src/data/client.ts:<line> ↔ docs/architecture/api-reference.md:<line>
  expected: <…>  actual: <…>
```

### 5. Check the SSE / Broadcast payload

The server emits `JSON.stringify(Broadcast)` per event, where
`Broadcast = CommandEvent & { canUndo, canRedo }`, i.e.
`{ label, transient, cascade, events: StoreEvent[], canUndo, canRedo }`, plus
periodic empty-data `event:'ping'` keep-alives.

Verify the client side in `src/data/client.ts`:

- `connectEvents` parses `e.data`, ignores empty-data pings (`if (!e.data) return`),
  runs `applyEvents(event.events)`, and updates the undo/redo store from
  `event.canUndo` / `event.canRedo`.
- Every `StoreEvent` variant the server can emit (`nodes-changed`,
  `files-changed`, `graphs-changed`, `placements-changed`, `edges-changed`,
  `vocab-changed`, `workspace-replaced`) has a branch in `applyEvents`. A new
  event type or a renamed field on the server with no matching client branch is a
  mismatch (silent stale cache).

Cross-reference the `StoreEvent` union in `src/data/events.ts` as the source of
truth for variant names.

## Output

A grouped report:

- **HTTP routes** — server ↔ client ↔ docs mismatches with line refs.
- **SSE payload** — Broadcast shape ↔ `applyEvents` mismatches.
- **Clean** — list the surfaces that fully agree (one line each).

If everything agrees, say so explicitly and name the route count checked.
