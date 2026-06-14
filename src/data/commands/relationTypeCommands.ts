import { getDb, type GnosisDB } from '../db'
import { relationColor } from '../relationColor'
import type { EdgeRecord, RelationTypeRecord } from '../types'
import { dispatch } from './dispatcher'
import { DuplicateNameError, findVocabByNameCI, VocabInUseError } from './integrity'
import type { Command } from './types'

export interface CreateRelationTypeCommand extends Command {
  relationTypeId: string
}

export function createRelationType(name: string, color?: string): CreateRelationTypeCommand {
  const relationTypeId = crypto.randomUUID()
  const trimmed = name.trim()
  // Every relation carries a color; inline paths (picker/DSL/decompose) pass
  // none, so derive one from the name.
  const finalColor = color ?? relationColor(trimmed)
  const now = Date.now()
  return {
    label: 'create-relation-type',
    relationTypeId,
    async do(db) {
      const existing = await findVocabByNameCI(db.relationTypes, trimmed)
      if (existing) throw new DuplicateNameError(existing.id)
      await db.relationTypes.add({
        id: relationTypeId,
        name: trimmed,
        color: finalColor,
        createdAt: now,
        updatedAt: now,
      })
      return [{ type: 'vocab-changed' }]
    },
    async undo(db) {
      await db.relationTypes.delete(relationTypeId)
      return [{ type: 'vocab-changed' }]
    },
  }
}

/**
 * Inline create-at-point-of-use (§3): a name matching an existing relation
 * type case-insensitively selects it instead of duplicating.
 */
export async function ensureRelationType(name: string): Promise<string> {
  const existing = await findVocabByNameCI(getDb().relationTypes, name)
  if (existing) return existing.id
  const command = createRelationType(name)
  await dispatch(command)
  return command.relationTypeId
}

async function getRelationTypeOrThrow(db: GnosisDB, id: string): Promise<RelationTypeRecord> {
  const row = await db.relationTypes.get(id)
  if (!row) throw new Error(`Relation type ${id} not found`)
  return row
}

export function renameRelationType(id: string, name: string): Command {
  const trimmed = name.trim()
  let captured: RelationTypeRecord | null = null
  const now = Date.now()
  return {
    label: 'rename-relation-type',
    async do(db) {
      const existing = await findVocabByNameCI(db.relationTypes, trimmed)
      if (existing && existing.id !== id) throw new DuplicateNameError(existing.id)
      const row = await getRelationTypeOrThrow(db, id)
      captured = structuredClone(row)
      await db.relationTypes.put({ ...row, name: trimmed, updatedAt: now })
      return [{ type: 'vocab-changed' }]
    },
    async undo(db) {
      if (captured) await db.relationTypes.put(captured)
      return [{ type: 'vocab-changed' }]
    },
  }
}

export function recolorRelationType(id: string, color: string): Command {
  let captured: RelationTypeRecord | null = null
  const now = Date.now()
  return {
    label: 'recolor-relation-type',
    async do(db) {
      const row = await getRelationTypeOrThrow(db, id)
      captured = structuredClone(row)
      await db.relationTypes.put({ ...row, color, updatedAt: now })
      return [{ type: 'vocab-changed' }]
    },
    async undo(db) {
      if (captured) await db.relationTypes.put(captured)
      return [{ type: 'vocab-changed' }]
    },
  }
}

/** §3: in-use deletion path — re-points all edges of `fromId` onto `intoId`. */
export function mergeRelationType(fromId: string, intoId: string): Command {
  if (fromId === intoId) throw new Error('Cannot merge a relation type into itself')
  let captured: { row: RelationTypeRecord; edges: EdgeRecord[] } | null = null
  const now = Date.now()
  return {
    label: 'merge-relation-type',
    cascade: true,
    async do(db) {
      const row = await getRelationTypeOrThrow(db, fromId)
      await getRelationTypeOrThrow(db, intoId)
      const edges = await db.edges.where('relationTypeId').equals(fromId).toArray()
      captured = structuredClone({ row, edges })
      await db.edges.bulkPut(edges.map((e) => ({ ...e, relationTypeId: intoId, updatedAt: now })))
      await db.relationTypes.delete(fromId)
      return [
        { type: 'vocab-changed' },
        { type: 'edges-changed', graphIds: [...new Set(edges.map((e) => e.graphId))] },
      ]
    },
    async undo(db) {
      if (!captured) return []
      await db.relationTypes.put(captured.row)
      await db.edges.bulkPut(captured.edges)
      return [
        { type: 'vocab-changed' },
        { type: 'edges-changed', graphIds: [...new Set(captured.edges.map((e) => e.graphId))] },
      ]
    },
  }
}

/** §3: only unused relation types may be deleted; in-use requires merge first. */
export function deleteRelationType(id: string): Command {
  let captured: RelationTypeRecord | null = null
  return {
    label: 'delete-relation-type',
    async do(db) {
      const count = await db.edges.where('relationTypeId').equals(id).count()
      if (count > 0) throw new VocabInUseError(count)
      const row = await getRelationTypeOrThrow(db, id)
      captured = structuredClone(row)
      await db.relationTypes.delete(id)
      return [{ type: 'vocab-changed' }]
    },
    async undo(db) {
      if (captured) await db.relationTypes.put(captured)
      return [{ type: 'vocab-changed' }]
    },
  }
}
