// Headless API check for the self-hosted server. Assumes it's running on $BASE.
const BASE = process.env.BASE ?? 'http://localhost:8788'

let passed = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ok   ${name}`) }
  else { failures.push(name); console.log(`  FAIL ${name} ${detail}`) }
}

const get = async (p) => (await fetch(BASE + p)).json()
const post = async (p, body) =>
  (await fetch(BASE + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })).json()
const cmd = (kind, args) => post('/api/command', { kind, args })

// Wait for boot.
for (let i = 0; i < 50; i++) {
  try { await get('/api/meta'); break } catch { await new Promise((r) => setTimeout(r, 100)) }
}

const meta = await get('/api/meta')
check('meta exposes graph ids', !!meta.rootGraphId && !!meta.homeGraphId, JSON.stringify(meta))
const g = meta.rootGraphId

// No-auto-file: a bare create-node mints NO file (content is opt-in). One node
// is given a starting file; the other stays file-less.
const a = await cmd('create-node', {
  title: 'Poseidon',
  file: { filename: 'poseidon.md', format: 'markdown', content: '# Poseidon' },
  placement: { graphId: g, x: 0, y: 0 },
})
const b = await cmd('create-node', { title: 'k-anon', placement: { graphId: g, x: 200, y: 0 } })
check('create-node returns a nodeId', !!a.result?.nodeId && !!b.result?.nodeId)

let files = await get('/api/files')
check(
  'bare create-node mints no file; a file-bearing node lists once (filename + nodeId, no content)',
  files.length === 1 && files.every((f) => f.filename && f.nodeId && !('content' in f)),
  `got ${files.length}`,
)

// "Create file" on the file-less node works (mirrors the panel's Create file button).
await cmd('set-node-file', { nodeId: b.result.nodeId, filename: 'untitled.md', format: 'markdown' })
files = await get('/api/files')
check(
  'set-node-file gives the file-less node a file',
  files.length === 2 && files.some((f) => f.nodeId === b.result.nodeId),
  `got ${files.length}`,
)

let graph = await get(`/api/graph/${g}`)
check('graph has the two placements', graph.placements.length === 2, `got ${graph.placements.length}`)

const rt = await post('/api/ensure/relationType', { name: 'depends on' })
check('ensure relation type returns id', !!rt.id)
await cmd('create-edge', { graphId: g, fromNodeId: a.result.nodeId, toNodeId: b.result.nodeId, relationTypeId: rt.id })
graph = await get(`/api/graph/${g}`)
check('edge created', graph.edges.length === 1, `got ${graph.edges.length}`)

let u = await post('/api/undo')
graph = await get(`/api/graph/${g}`)
check('undo removes the edge', graph.edges.length === 0 && u.canRedo === true)
await post('/api/redo')
graph = await get(`/api/graph/${g}`)
check('redo restores the edge', graph.edges.length === 1)

const appears = await get(`/api/node/${a.result.nodeId}/appears-in`)
check('appears-in lists the graph', appears.graphs.length === 1)

const search = await get('/api/search?q=Poseidon')
check('search finds the node', search.some((h) => h.id === a.result.nodeId), JSON.stringify(search))

await cmd('delete-node-everywhere', { nodeId: a.result.nodeId })
graph = await get(`/api/graph/${g}`)
check('delete-node cascades placement + edge', graph.placements.length === 1 && graph.edges.length === 0)

const vocab = await get('/api/vocab')
check('vocab has seeded kinds + relation types', vocab.kinds.length === 5 && vocab.relationTypes.length >= 6)

const bundle = await get('/api/export')
check('export bundle is well-formed', bundle.schemaVersion === 3 && Array.isArray(bundle.nodes) && Array.isArray(bundle.files) && !!bundle.meta?.homeGraphId)

// Rewind every mutation this script made so the next script on the shared server
// starts from the pristine seed state (the seed itself is not on the undo stack).
for (let i = 0; i < 100; i++) {
  const u = await post('/api/undo')
  if (!u.canUndo) break
}

console.log(`\n${passed} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
