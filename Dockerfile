# Self-hosted gnosis-graphs: one Node process serves the built SPA + the API +
# SSE, backed by SQLite (node:sqlite, built in) and the host filesystem.
FROM node:24-slim
WORKDIR /app

RUN corepack enable

# Install deps first for layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Build the client (dist/) and the docs site (docs/.vitepress/dist) — the server
# serves both. The built docs are static; no separate docs server is needed.
COPY . .
RUN pnpm build
RUN pnpm docs:build

ENV PORT=8787
ENV GNOSIS_DB=/app/data/gnosis.db
ENV GNOSIS_STATIC=/app/dist
ENV GNOSIS_DOCS=/app/docs/.vitepress/dist
EXPOSE 8787

# tsx runs the TypeScript server directly (erasable-syntax-only project).
CMD ["pnpm", "server"]
