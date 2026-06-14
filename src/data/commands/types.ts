import type { GnosisDB } from '../db'
import type { StoreEvent } from '../events'

export interface Command {
  label: string
  /** Persists and emits events but never touches the undo/redo stacks. */
  transient?: boolean
  /** Destructive cascade — triggers an immediate snapshot after commit. */
  cascade?: boolean
  do(db: GnosisDB): Promise<StoreEvent[]>
  undo(db: GnosisDB): Promise<StoreEvent[]>
}
