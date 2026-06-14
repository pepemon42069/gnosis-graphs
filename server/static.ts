import { serveStatic } from '@hono/node-server/serve-static'
import type { Hono } from 'hono'

/**
 * Serve the built docs (/docs/*) and SPA (/*). Registered AFTER the /api routes
 * so the API always wins, and /docs/* before /* so docs never fall through to
 * the SPA. In dev, Vite serves the client and proxies /api here.
 */
export function registerStatic(app: Hono): void {
  // Always revalidate the HTML shell (SPA + docs) so a fresh build shows up
  // immediately; hashed JS/CSS assets are content-addressed and safe to cache.
  app.use('/*', async (c, next) => {
    await next()
    if (c.res.headers.get('content-type')?.includes('text/html')) {
      c.header('Cache-Control', 'no-cache')
    }
  })

  // Strip the /docs prefix to map onto the dist root; a scoped fallback serves
  // index.html so clean-URL/client-routed paths resolve (mirrors the SPA fallback).
  const DOCS = process.env.GNOSIS_DOCS ?? './docs/.vitepress/dist'
  app.use('/docs/*', serveStatic({ root: DOCS, rewriteRequestPath: (p) => p.replace(/^\/docs/, '') }))
  app.get('/docs/*', serveStatic({ path: `${DOCS}/index.html` }))

  const STATIC = process.env.GNOSIS_STATIC ?? './dist'
  app.use('/*', serveStatic({ root: STATIC }))
  app.get('/*', serveStatic({ path: `${STATIC}/index.html` }))
}
