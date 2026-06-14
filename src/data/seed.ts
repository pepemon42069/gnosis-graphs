import { SCHEMA_VERSION } from './bundle/migrate'
import { getMeta, type GnosisDB, setMeta } from './db'
import { relationColor } from './relationColor'

const SEED_VERSION = 3

const RELATION_TYPES: { name: string; color: string }[] = [
  { name: 'relates to', color: '#8a8f98' },
  { name: 'implements', color: '#4caf7d' },
  { name: 'cites', color: '#5b8def' },
  { name: 'contradicts', color: '#e05d5d' },
  { name: 'depends on', color: '#e0a458' },
  { name: 'part of', color: '#8e7cc3' },
]

const KINDS: { name: string; color: string; icon: string }[] = [
  { name: 'concept', color: '#5b8def', icon: '💡' },
  { name: 'paper', color: '#b08968', icon: '📄' },
  { name: 'contract', color: '#8e7cc3', icon: '📜' },
  { name: 'question', color: '#e0a458', icon: '❓' },
  { name: 'decision', color: '#4caf7d', icon: '⚖️' },
]

/**
 * Versioned, idempotent first-run seeding. Runs once per seed step — seeds are
 * defaults, not assertions, so later user edits and deletions stick.
 */
export async function seedWorkspace(db: GnosisDB): Promise<void> {
  await db.transaction(async () => {
    const current = ((await db.meta.get('seedVersion'))?.value as number | undefined) ?? 0
    if (current >= SEED_VERSION) return
    if (current < 1) await seedInitial(db)
    if (current < 2) await seedHome(db)
    if (current < 3) await backfillRelationColors(db)
    await setMeta(db, 'seedVersion', SEED_VERSION)
    await setMeta(db, 'schemaVersion', SCHEMA_VERSION)
  })
}

/** Step 3: relations are always colored now — give older color-less rows one. */
async function backfillRelationColors(db: GnosisDB): Promise<void> {
  const now = Date.now()
  const missing = (await db.relationTypes.toArray()).filter((r) => !r.color)
  if (missing.length)
    await db.relationTypes.bulkPut(
      missing.map((r) => ({ ...r, color: relationColor(r.name), updatedAt: now })),
    )
}

/** Step 2 (v0.2): Home, the graph-of-graphs; an existing root gets a referring node. */
async function seedHome(db: GnosisDB): Promise<void> {
  const now = Date.now()
  const homeGraphId = crypto.randomUUID()
  await db.graphs.add({ id: homeGraphId, name: 'Default', createdAt: now, updatedAt: now })
  await setMeta(db, 'homeGraphId', homeGraphId)
  const rootGraphId = await getMeta<string>(db, 'rootGraphId')
  const root = rootGraphId ? await db.graphs.get(rootGraphId) : undefined
  if (!root) return
  const nodeId = crypto.randomUUID()
  await db.nodes.add({
    id: nodeId,
    title: root.name,
    tags: [],
    childGraphId: root.id,
    createdAt: now,
    updatedAt: now,
  })
  await db.placements.add({
    id: crypto.randomUUID(),
    graphId: homeGraphId,
    nodeId,
    x: 0,
    y: 0,
    createdAt: now,
    updatedAt: now,
  })
}

async function seedInitial(db: GnosisDB): Promise<void> {
  const now = Date.now()
  await db.relationTypes.bulkAdd(
    RELATION_TYPES.map((t) => ({ id: crypto.randomUUID(), ...t, createdAt: now, updatedAt: now })),
  )
  await db.kinds.bulkAdd(
    KINDS.map((k) => ({ id: crypto.randomUUID(), ...k, createdAt: now, updatedAt: now })),
  )
  const rootGraphId = crypto.randomUUID()
  await db.graphs.add({ id: rootGraphId, name: 'First graph', createdAt: now, updatedAt: now })
  await setMeta(db, 'rootGraphId', rootGraphId)
}
