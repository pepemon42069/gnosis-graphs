/// <reference types="node" />
import { type Context, Hono } from 'hono'
import { resolveInitialGraphId } from '../src/data/bootstrap'
import { exportBundle } from '../src/data/bundle/exportBundle'
import { importBundle } from '../src/data/bundle/importBundle'
import { clearHistory } from '../src/data/commands/dispatcher'
import { getDb, getMeta } from '../src/data/db'
import { emitCommand } from '../src/data/events'
import { DEFAULT_LAYOUT, elkLayout, estimateNodeSize, type LayoutStyle } from '../src/data/graphLayout'
import { seedWorkspace } from '../src/data/seed'
import {
  appearsIn,
  edgesByGraph,
  kindUsage,
  looseEnds,
  placementsByGraph,
  relationTypeUsage,
} from '../src/data/queries'
import { searchWorkspace } from '../src/data/search/searchIndex'
import { parseGraphSource } from '../src/data/source/parse'
import { planGraphSource } from '../src/data/source/plan'
import { serializeGraphSource } from '../src/data/source/serialize'
import { buildDecomposeCommand, type DecomposeInput } from './decompose'
import { buildApplyCommand } from './graphSource'
import {
  dispatchComposite,
  ensureVocab,
  runCommand,
  runRedo,
  runUndo,
  serializeRead,
  undoState,
} from './registry'
import { registerEvents } from './events-sse'
import { registerStatic } from './static'
import { writeSnapshot } from './snapshots'

export const app = new Hono()

const fail = (e: unknown) => (e instanceof Error ? e.message : String(e))

// §9: snapshot before a destructive write; on snapshot failure refuse the op
// (return 500) so we never destroy without a copy. Returns the refusal response,
// or null when the snapshot succeeded and the caller may proceed.
async function snapshotOrRefuse(c: Context, phase: string, undone: string): Promise<Response | null> {
  try {
    await writeSnapshot()
    return null
  } catch {
    return c.json(
      { ok: false, error: `Pre-${phase} snapshot failed — ${undone} Retry once snapshots can be written.` },
      500,
    )
  }
}

app.post('/api/command', async (c) => {
  const body = (await c.req.json()) as { kind: string; args?: Record<string, unknown> }
  try {
    const r = await runCommand(body.kind, body.args ?? {})
    return c.json({ ok: true, ...r })
  } catch (e) {
    return c.json({ ok: false, error: fail(e) }, 400)
  }
})

// Decompose a markdown document (concepts + typed relations) into a brand-new
// graph, auto-laid-out so it starts legible. elk runs HERE — before dispatch —
// so the layout never holds the write transaction open. `layout: 'grid'` opts out.
app.post('/api/decompose', async (c) => {
  const body = (await c.req.json()) as DecomposeInput & { layout?: LayoutStyle | 'grid' }
  try {
    const concepts = body.concepts ?? []
    const style: LayoutStyle =
      body.layout === 'flow' || body.layout === 'web' ? body.layout : DEFAULT_LAYOUT
    if (body.layout !== 'grid' && concepts.length) {
      const nodes = concepts.map((cn) => ({
        id: cn.key,
        tags: cn.tags ?? [],
        ...estimateNodeSize(cn.title, (cn.tags?.length ?? 0) > 0, !!cn.summary),
      }))
      const keys = new Set(nodes.map((n) => n.id))
      const edges = (body.relations ?? [])
        .filter((r) => keys.has(r.from) && keys.has(r.to))
        .map((r, i) => ({ id: `e${i}`, source: r.from, target: r.to }))
      // Cluster related-tag concepts together at construction (web style only).
      const positions = await elkLayout({ nodes, edges }, style, true)
      for (const cn of concepts) cn.position = positions.get(cn.key) ?? cn.position
    }
    const command = buildDecomposeCommand({
      graphName: body.graphName,
      concepts,
      relations: body.relations ?? [],
    })
    await dispatchComposite(command)
    return c.json({ ok: true, graphId: command.graphId })
  } catch (e) {
    return c.json({ ok: false, error: fail(e) }, 400)
  }
})

app.post('/api/undo', async (c) => {
  await runUndo()
  return c.json({ ok: true, ...undoState() })
})

app.post('/api/redo', async (c) => {
  await runRedo()
  return c.json({ ok: true, ...undoState() })
})

app.get('/api/graph/:id', async (c) => {
  const id = c.req.param('id')
  const [placements, edges] = await Promise.all([placementsByGraph(id), edgesByGraph(id)])
  return c.json({ placements, edges })
})

app.get('/api/graph/:id/source', async (c) => {
  const source = await serializeGraphSource(getDb(), c.req.param('id'))
  return c.json({ source })
})

app.post('/api/graph/:id/source', async (c) => {
  const graphId = c.req.param('id')
  const { source, dryRun } = (await c.req.json()) as { source: string; dryRun?: boolean }
  const parsed = parseGraphSource(source)
  if ('errors' in parsed) return c.json({ ok: false, errors: parsed.errors }, 400)
  try {
    const plan = await planGraphSource(getDb(), graphId, parsed.graph)
    if (dryRun) return c.json({ ok: true, summary: plan.summary })
    // §9: a destructive apply snapshots first; a failed write refuses the apply.
    if (plan.nodesRemoved.length > 0) {
      const refused = await snapshotOrRefuse(c, 'apply', 'the graph was NOT changed.')
      if (refused) return refused
    }
    await dispatchComposite(buildApplyCommand(graphId, parsed.graph))
    return c.json({ ok: true, summary: plan.summary })
  } catch (e) {
    return c.json({ ok: false, error: fail(e) }, 400)
  }
})

app.get('/api/file/:id', async (c) => {
  const file = await getDb().files.get(c.req.param('id'))
  return file ? c.json(file) : c.json(null, 404)
})

// Lightweight listing for the sidebar file explorer — every file's identity and
// filename, never its content (which can be large; fetched per-file on open).
app.get('/api/files', async (c) => {
  const files = await getDb().files.toArray()
  return c.json(
    files.map(({ id, nodeId, filename, format, language }) => ({ id, nodeId, filename, format, language })),
  )
})

app.get('/api/node/:id/appears-in', async (c) => c.json(await appearsIn(c.req.param('id'))))
app.get('/api/loose-ends', async (c) => c.json(await looseEnds()))

app.get('/api/vocab', async (c) => {
  const db = getDb()
  const [nodes, kinds, relationTypes, graphs] = await Promise.all([
    db.nodes.toArray(),
    db.kinds.toArray(),
    db.relationTypes.toArray(),
    db.graphs.toArray(),
  ])
  return c.json({ nodes, kinds, relationTypes, graphs })
})

app.get('/api/usage/kind/:id', async (c) => c.json({ count: await kindUsage(c.req.param('id')) }))
app.get('/api/usage/relation-type/:id', async (c) =>
  c.json({ count: await relationTypeUsage(c.req.param('id')) }),
)

app.get('/api/search', (c) => c.json(searchWorkspace(c.req.query('q') ?? '')))

app.post('/api/ensure/:table', async (c) => {
  const table = c.req.param('table') === 'kind' ? 'kind' : 'relationType'
  const { name } = (await c.req.json()) as { name: string }
  return c.json(await ensureVocab(table, name))
})

app.get('/api/export', async (c) => c.json(await serializeRead(() => exportBundle())))
app.post('/api/import', async (c) => {
  const body = await c.req.json()
  const refused = await snapshotOrRefuse(c, 'import', 'the workspace was NOT replaced.')
  if (refused) return refused
  await importBundle(body)
  return c.json({ ok: true })
})

/**
 * Reset to a clean empty workspace (§9). Clears every table — including meta, so
 * the dropped seedVersion lets seedWorkspace re-run fresh — then re-seeds and
 * announces a workspace-replaced, mirroring importBundle's tail. The mirror dir
 * handle is environment config, not workspace data, so it survives (§8).
 */
async function resetWorkspace(): Promise<void> {
  const db = getDb()
  await db.transaction(async () => {
    const mirrorRow = await db.meta.get('mirrorDirHandle')
    await Promise.all(db.tables.map((table) => table.clear()))
    if (mirrorRow) await db.meta.put(mirrorRow)
  })
  await seedWorkspace(db)
  clearHistory()
  emitCommand({
    label: 'reset-workspace',
    transient: false,
    cascade: true,
    events: [{ type: 'workspace-replaced' }],
  })
}

app.post('/api/reset', async (c) => {
  const refused = await snapshotOrRefuse(c, 'reset', 'the workspace was NOT reset.')
  if (refused) return refused
  await resetWorkspace()
  return c.json({ ok: true })
})

app.get('/api/meta', async (c) => {
  const db = getDb()
  return c.json({
    homeGraphId: (await getMeta<string>(db, 'homeGraphId')) ?? null,
    rootGraphId: (await getMeta<string>(db, 'rootGraphId')) ?? null,
    initialGraphId: await resolveInitialGraphId(),
  })
})

// SSE reactivity, then static (docs + SPA) — registered last so /api wins.
registerEvents(app)
registerStatic(app)
