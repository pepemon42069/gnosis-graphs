import { useEffect, useMemo, useState } from 'react'
import { useSessionStore } from '../app/store'
import { searchWorkspace } from '../data/client'
import { useContentStore } from '../data/react/contentStore'
import type { KindRecord, NodeRecord, RelationTypeRecord } from '../data/types'
import { rankedPlacements } from './placementRank'

export type PickerRow =
  | { key: string; kind: 'node'; nodeId: string; title: string; icon?: string; hint?: string }
  | { key: string; kind: 'nodePlacement'; nodeId: string; graphId: string; title: string; graphName: string }
  | { key: string; kind: 'graph'; graphId: string; name: string }
  | { key: string; kind: 'createNode'; query: string }
  | { key: string; kind: 'relationType'; relationTypeId: string; name: string }
  | { key: string; kind: 'createRelationType'; query: string }

type Hit = { id: string; type: 'node' | 'graph'; title: string; score: number }

const COMMAND_HIT_CAP = 12

export interface PickerResults {
  rows: PickerRow[]
  /** Row preselected before any arrow-key movement. */
  defaultIndex: number
}

function nodeRowFromHit(hit: Hit, nodes: Map<string, NodeRecord>, kinds: Map<string, KindRecord>): PickerRow {
  const node = nodes.get(hit.id)
  const kind = node?.kindId ? kinds.get(node.kindId) : undefined
  return { key: hit.id, kind: 'node', nodeId: hit.id, title: hit.title, icon: kind?.icon }
}

/** Existing nodes surface before create — the §7 anti-duplicate rule. */
function appendCreateNode(rows: PickerRow[], trimmed: string): void {
  const create: PickerRow = { key: 'create', kind: 'createNode', query: trimmed }
  if (rows.length) rows.push(create)
  else rows.unshift(create)
}

function nodeRows(query: string, hits: Hit[], nodes: Map<string, NodeRecord>, kinds: Map<string, KindRecord>): PickerResults {
  const trimmed = query.trim()
  const rows: PickerRow[] = hits
    .filter((hit) => hit.type === 'node')
    .map((hit) => nodeRowFromHit(hit, nodes, kinds))
  if (trimmed) appendCreateNode(rows, trimmed)
  return { rows, defaultIndex: 0 }
}

function relationTypeRows(
  query: string,
  relationTypes: Map<string, RelationTypeRecord>,
): PickerResults {
  const trimmed = query.trim()
  const needle = trimmed.toLowerCase()
  const matched = [...relationTypes.values()]
    .filter((t) => !needle || t.name.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name))
  const rows: PickerRow[] = matched.map(
    (t): PickerRow => ({ key: t.id, kind: 'relationType', relationTypeId: t.id, name: t.name }),
  )
  if (trimmed && !matched.some((t) => t.name.toLowerCase() === needle)) {
    rows.push({ key: 'create', kind: 'createRelationType', query: trimmed })
  }
  // Enter accepts `relates to` so edges never demand taxonomy work (§5).
  const preselect = rows.findIndex(
    (r) => r.kind === 'relationType' && r.name.toLowerCase() === 'relates to',
  )
  return { rows, defaultIndex: Math.max(0, preselect) }
}

/** Mod+K rows: graphs open, nodes jump to their best placement, further rows
 * enumerate the other placements (§7). */
async function commandRows(
  query: string,
  hits: Hit[],
  kinds: Map<string, KindRecord>,
  nodes: Map<string, NodeRecord>,
  recentGraphIds: string[],
): Promise<PickerRow[]> {
  const trimmed = query.trim()
  // Resolve every node hit's placements concurrently — one HTTP round-trip apiece —
  // then flatten in hit order so graph/node rows keep their original ranking.
  const groups = await Promise.all(
    hits.slice(0, COMMAND_HIT_CAP).map(async (hit): Promise<PickerRow[]> => {
      if (hit.type === 'graph') {
        return [{ key: `g:${hit.id}`, kind: 'graph', graphId: hit.id, name: hit.title }]
      }
      const node = nodes.get(hit.id)
      const kind = node?.kindId ? kinds.get(node.kindId) : undefined
      const placed = await rankedPlacements(hit.id, recentGraphIds)
      return [
        {
          key: hit.id,
          kind: 'node',
          nodeId: hit.id,
          title: hit.title,
          ...(kind?.icon ? { icon: kind.icon } : {}),
          hint: placed[0]?.graphName ?? 'unplaced',
        },
        ...placed.slice(1).map(({ placement, graphName }): PickerRow => ({
          key: `${hit.id}:${placement.graphId}`,
          kind: 'nodePlacement',
          nodeId: hit.id,
          graphId: placement.graphId,
          title: hit.title,
          graphName,
        })),
      ]
    }),
  )
  const rows = groups.flat()
  if (trimmed) appendCreateNode(rows, trimmed)
  return rows
}

const EMPTY: PickerResults = { rows: [], defaultIndex: 0 }

/** Search now lives on the server; node/command rows resolve asynchronously. */
export function usePickerResults(query: string): PickerResults {
  const mode = useSessionStore((s) => s.picker?.mode ?? null)
  const recentGraphIds = useSessionStore((s) => s.recentGraphIds)
  const nodes = useContentStore((s) => s.nodes)
  const kinds = useContentStore((s) => s.kinds)
  const relationTypes = useContentStore((s) => s.relationTypes)
  const [asyncResults, setAsyncResults] = useState<PickerResults>(EMPTY)

  // Relation-type rows come from the in-memory vocab — computed at render.
  const relRows = useMemo(
    () => (mode === 'relationType' ? relationTypeRows(query, relationTypes) : null),
    [mode, query, relationTypes],
  )

  // node / command rows resolve through the server search.
  useEffect(() => {
    if (mode !== 'node' && mode !== 'command') return
    let alive = true
    void searchWorkspace(query).then(async (hits) => {
      const next =
        mode === 'node'
          ? nodeRows(query, hits, nodes, kinds)
          : { rows: await commandRows(query, hits, kinds, nodes, recentGraphIds), defaultIndex: 0 }
      if (alive) setAsyncResults(next)
    })
    return () => {
      alive = false
    }
  }, [mode, query, nodes, kinds, recentGraphIds])

  if (mode === null) return EMPTY
  return relRows ?? asyncResults
}
