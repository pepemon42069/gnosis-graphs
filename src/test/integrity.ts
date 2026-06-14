import type { GnosisDB } from '../data/db'

/**
 * The spec's forbidden bug class, encoded (§3): no placement, edge, kindId, or
 * childGraphId may dangle. Called after every do/undo/redo in cascade tests.
 */
export async function assertIntegrity(db: GnosisDB): Promise<void> {
  const nodes = await db.nodes.toArray()
  const files = await db.files.toArray()
  const nodeIds = new Set(nodes.map((n) => n.id))
  const fileIds = new Set(files.map((f) => f.id))
  const graphIds = new Set((await db.graphs.toArray()).map((g) => g.id))
  const relationTypeIds = new Set((await db.relationTypes.toArray()).map((t) => t.id))
  const kindIds = new Set((await db.kinds.toArray()).map((k) => k.id))

  for (const p of await db.placements.toArray()) {
    if (!graphIds.has(p.graphId)) throw new Error(`Placement ${p.id} dangles: graph ${p.graphId}`)
    if (!nodeIds.has(p.nodeId)) throw new Error(`Placement ${p.id} dangles: node ${p.nodeId}`)
  }
  for (const e of await db.edges.toArray()) {
    if (!graphIds.has(e.graphId)) throw new Error(`Edge ${e.id} dangles: graph ${e.graphId}`)
    if (!nodeIds.has(e.fromNodeId)) throw new Error(`Edge ${e.id} dangles: from ${e.fromNodeId}`)
    if (!nodeIds.has(e.toNodeId)) throw new Error(`Edge ${e.id} dangles: to ${e.toNodeId}`)
    if (!relationTypeIds.has(e.relationTypeId)) {
      throw new Error(`Edge ${e.id} dangles: relation type ${e.relationTypeId}`)
    }
  }
  for (const f of files) {
    if (!nodeIds.has(f.nodeId)) throw new Error(`File ${f.id} dangles: node ${f.nodeId}`)
  }
  for (const n of nodes) {
    if (n.kindId && !kindIds.has(n.kindId)) {
      throw new Error(`Node ${n.id} dangles: kind ${n.kindId}`)
    }
    if (n.childGraphId && !graphIds.has(n.childGraphId)) {
      throw new Error(`Node ${n.id} dangles: child graph ${n.childGraphId}`)
    }
    if (n.payload?.kind === 'file' && !fileIds.has(n.payload.fileId)) {
      throw new Error(`Node ${n.id} dangles: file ${n.payload.fileId}`)
    }
  }
}
