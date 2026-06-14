export type StoreEvent =
  | { type: 'nodes-changed'; upserted: string[]; removed: string[] }
  | { type: 'files-changed'; fileIds: string[] }
  | { type: 'graphs-changed'; upserted: string[]; removed: string[] }
  | { type: 'placements-changed'; graphIds: string[] }
  | { type: 'edges-changed'; graphIds: string[] }
  | { type: 'vocab-changed' }
  | { type: 'workspace-replaced' }

export interface CommandEvent {
  label: string
  transient: boolean
  cascade: boolean
  events: StoreEvent[]
}

type CommandListener = (event: CommandEvent) => void

const listeners = new Set<CommandListener>()

export function onCommand(listener: CommandListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitCommand(event: CommandEvent): void {
  for (const listener of listeners) listener(event)
}
