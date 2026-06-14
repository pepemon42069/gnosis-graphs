import { getDb, type GnosisDB } from '../db'
import { kindPreset } from '../kindPresets'
import type { KindRecord } from '../types'
import { dispatch } from './dispatcher'
import { DuplicateNameError, findVocabByNameCI, VocabInUseError } from './integrity'
import type { Command } from './types'

export interface CreateKindCommand extends Command {
  kindId: string
}

export function createKind(name: string, color: string, icon: string): CreateKindCommand {
  const kindId = crypto.randomUUID()
  const trimmed = name.trim()
  const now = Date.now()
  return {
    label: 'create-kind',
    kindId,
    async do(db) {
      const existing = await findVocabByNameCI(db.kinds, trimmed)
      if (existing) throw new DuplicateNameError(existing.id)
      await db.kinds.add({ id: kindId, name: trimmed, color, icon, createdAt: now, updatedAt: now })
      return [{ type: 'vocab-changed' }]
    },
    async undo(db) {
      await db.kinds.delete(kindId)
      return [{ type: 'vocab-changed' }]
    },
  }
}

/**
 * Inline create-at-point-of-use (§3): a name matching an existing kind
 * case-insensitively selects it instead of duplicating.
 */
export async function ensureKind(name: string): Promise<string> {
  const existing = await findVocabByNameCI(getDb().kinds, name)
  if (existing) return existing.id
  const { color, icon } = kindPreset(name)
  const command = createKind(name, color, icon)
  await dispatch(command)
  return command.kindId
}

async function getKindOrThrow(db: GnosisDB, id: string): Promise<KindRecord> {
  const kind = await db.kinds.get(id)
  if (!kind) throw new Error(`Kind ${id} not found`)
  return kind
}

export function renameKind(id: string, name: string): Command {
  const trimmed = name.trim()
  let captured: KindRecord | null = null
  const now = Date.now()
  return {
    label: 'rename-kind',
    async do(db) {
      const existing = await findVocabByNameCI(db.kinds, trimmed)
      if (existing && existing.id !== id) throw new DuplicateNameError(existing.id)
      const kind = await getKindOrThrow(db, id)
      captured = structuredClone(kind)
      await db.kinds.put({ ...kind, name: trimmed, updatedAt: now })
      return [{ type: 'vocab-changed' }]
    },
    async undo(db) {
      if (captured) await db.kinds.put(captured)
      return [{ type: 'vocab-changed' }]
    },
  }
}

export function recolorKind(id: string, patch: { color?: string; icon?: string }): Command {
  let captured: KindRecord | null = null
  const now = Date.now()
  return {
    label: 'recolor-kind',
    async do(db) {
      const kind = await getKindOrThrow(db, id)
      captured = structuredClone(kind)
      await db.kinds.put({
        ...kind,
        ...(patch.color !== undefined ? { color: patch.color } : {}),
        ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
        updatedAt: now,
      })
      return [{ type: 'vocab-changed' }]
    },
    async undo(db) {
      if (captured) await db.kinds.put(captured)
      return [{ type: 'vocab-changed' }]
    },
  }
}

/**
 * §3: in-use deletion path — re-points all nodes of `fromId` onto `intoId`.
 * Undo patches only kindId/updatedAt on the CURRENT rows: transient title and
 * payload edits made after the merge must survive a structural undo (§6/§8).
 */
export function mergeKind(fromId: string, intoId: string): Command {
  if (fromId === intoId) throw new Error('Cannot merge a kind into itself')
  let captured: { row: KindRecord; nodes: { id: string; updatedAt: number }[] } | null = null
  const now = Date.now()
  return {
    label: 'merge-kind',
    cascade: true,
    async do(db) {
      const row = await getKindOrThrow(db, fromId)
      await getKindOrThrow(db, intoId)
      const nodes = await db.nodes.filter((n) => n.kindId === fromId).toArray()
      captured = structuredClone({
        row,
        nodes: nodes.map((n) => ({ id: n.id, updatedAt: n.updatedAt })),
      })
      await db.nodes.bulkPut(nodes.map((n) => ({ ...n, kindId: intoId, updatedAt: now })))
      await db.kinds.delete(fromId)
      return [
        { type: 'vocab-changed' },
        { type: 'nodes-changed', upserted: nodes.map((n) => n.id), removed: [] },
      ]
    },
    async undo(db) {
      if (!captured) return []
      await db.kinds.put(captured.row)
      const rows = await db.nodes.bulkGet(captured.nodes.map((n) => n.id))
      await db.nodes.bulkPut(
        rows.flatMap((row, i) => {
          const cap = captured?.nodes[i]
          return row && cap ? [{ ...row, kindId: fromId, updatedAt: cap.updatedAt }] : []
        }),
      )
      return [
        { type: 'vocab-changed' },
        { type: 'nodes-changed', upserted: captured.nodes.map((n) => n.id), removed: [] },
      ]
    },
  }
}

/** §3: only unused kinds may be deleted; in-use requires merge first. */
export function deleteKind(id: string): Command {
  let captured: KindRecord | null = null
  return {
    label: 'delete-kind',
    async do(db) {
      const count = await db.nodes.filter((n) => n.kindId === id).count()
      if (count > 0) throw new VocabInUseError(count)
      const kind = await getKindOrThrow(db, id)
      captured = structuredClone(kind)
      await db.kinds.delete(id)
      return [{ type: 'vocab-changed' }]
    },
    async undo(db) {
      if (captured) await db.kinds.put(captured)
      return [{ type: 'vocab-changed' }]
    },
  }
}
