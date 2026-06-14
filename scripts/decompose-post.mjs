// Post a decompose payload to the running gnosis-graphs server, which materializes
// it as a brand-new, auto-laid-out graph (one undo step). Used by the decompose-md
// skill instead of an ad-hoc curl. Read-only validation here; the server re-checks.
//
// Usage: node scripts/decompose-post.mjs <payload.json|-> [origin]
//   payload: { graphName, concepts:[{key,title,kind?,tags?,summary?,filename?,content}],
//              relations:[{from,to,type}], layout?: 'web'|'flow'|'grid' }
import { readFileSync } from 'node:fs'

const fileArg = process.argv[2]
const origin = (process.argv[3] ?? process.env.GNOSIS_ORIGIN ?? 'http://localhost:8787').replace(/\/$/, '')
if (!fileArg) {
  console.error('usage: node scripts/decompose-post.mjs <payload.json|-> [origin]')
  process.exit(1)
}

const raw = fileArg === '-' ? readFileSync(0, 'utf8') : readFileSync(fileArg, 'utf8')
let payload
try {
  payload = JSON.parse(raw)
} catch (e) {
  console.error('invalid JSON:', e.message)
  process.exit(1)
}

const concepts = payload.concepts ?? []
const relations = payload.relations ?? []
if (!payload.graphName || !concepts.length) {
  console.error('payload needs graphName + a non-empty concepts[]')
  process.exit(1)
}

// Friendly pre-checks (the server validates too, but the messages are clearer here).
const keys = new Set()
for (const c of concepts) {
  if (!c.key || !c.title || c.content == null) {
    console.error(`concept missing key/title/content: ${JSON.stringify(c).slice(0, 80)}`)
    process.exit(1)
  }
  if (keys.has(c.key)) {
    console.error(`duplicate concept key: ${c.key}`)
    process.exit(1)
  }
  keys.add(c.key)
}
for (const r of relations) {
  if (!keys.has(r.from) || !keys.has(r.to)) {
    console.error(`relation references unknown concept key: ${r.from} -> ${r.to}`)
    process.exit(1)
  }
}

const reachable = await fetch(origin + '/api/meta').then((r) => r.ok).catch(() => false)
if (!reachable) {
  console.error(`server not reachable at ${origin} — start it (docker compose up -d / pnpm server)`)
  process.exit(1)
}

const res = await fetch(origin + '/api/decompose', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
}).then((r) => r.json())

if (!res.ok) {
  console.error('decompose failed:', res.error)
  process.exit(1)
}
console.log(`✓ created graph ${res.graphId}`)
console.log(`  ${concepts.length} concept-nodes, ${relations.length} typed edges (layout: ${payload.layout ?? 'web'})`)
console.log(`  open:  ${origin}/#/g/${res.graphId}`)
console.log(`  undo:  curl -X POST ${origin}/api/undo`)
