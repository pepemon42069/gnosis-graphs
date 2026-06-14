export interface XY {
  x: number
  y: number
}

export type PickerState =
  /** Mod+K: fuzzy teleport across all nodes and graphs, create-from-miss (§7). */
  | { mode: 'command' }
  /** Search-or-create a node; `at` null means viewport center. */
  | { mode: 'node'; at: XY | null; forEdge: boolean }
  /** Pick a relation type for the pending edge, or retype an existing edge. */
  | { mode: 'relationType'; target: { type: 'pending' } | { type: 'edge'; edgeId: string } }

export interface PendingEdge {
  fromNodeId: string
  /** Set once a target is chosen — stage two of the gesture (§5). */
  toNodeId?: string
}

interface ContextMenuItem {
  label: string
  action: () => void
}

/** A custom right-click menu (§5): screen position plus its items. */
export interface ContextMenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

export interface ConfirmRequest {
  message: string
  confirmLabel: string
  /** Destructive action: the accept button renders filled danger-red. */
  isDanger?: boolean
  onConfirm: () => void
}

/** Themed single-line text prompt — the in-app replacement for window.prompt. */
export interface PromptRequest {
  message: string
  /** Pre-filled, selected on open (e.g. the current name on a rename). */
  initialValue?: string
  placeholder?: string
  submitLabel: string
  /** Receives the trimmed, non-empty value; not called on cancel/empty. */
  onSubmit: (value: string) => void
}

export interface Selection {
  nodeIds: string[]
  edgeIds: string[]
}
