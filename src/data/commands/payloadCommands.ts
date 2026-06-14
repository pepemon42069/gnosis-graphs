import { requireNonEmptyTitle } from './integrity'
import type { Command } from './types'
import { getNodeOrThrow, transientUndo } from './nodeCommands'

export function setNodeTitle(nodeId: string, title: string): Command {
  const trimmed = requireNonEmptyTitle(title)
  const now = Date.now()
  return {
    label: 'set-node-title',
    transient: true,
    async do(db) {
      const node = await getNodeOrThrow(db, nodeId)
      await db.nodes.put({ ...node, title: trimmed, updatedAt: now })
      return [{ type: 'nodes-changed', upserted: [nodeId], removed: [] }]
    },
    undo: transientUndo,
  }
}
