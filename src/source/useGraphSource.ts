import { useCallback, useState } from 'react'
import {
  applyGraphSource,
  type SourceError,
  type SourceSummary,
} from '../data/client'
import { closeOverlay } from '../nav/history'

type Phase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'errors'; errors: SourceError[]; message?: string }
  | { kind: 'confirm'; summary: SourceSummary }
  | { kind: 'applying' }

export interface GraphSourceApply {
  phase: Phase
  /** Run the dry-run; apply directly when nothing destructive, else ask to confirm. */
  apply(text: string): Promise<void>
  /** Commit the confirmed destructive apply. */
  confirm(text: string): Promise<void>
  /** Dismiss the confirm/error surface back to editing. */
  reset(): void
}

const isDestructive = (s: SourceSummary) => s.placementsRemoved > 0 || s.nodesDeleted > 0

/**
 * The dry-run → confirm-on-destructive → apply flow for the graph-source editor.
 * Errors come back as a 400 body (not a throw), so every step branches on `ok`.
 * A clean non-destructive apply runs straight through and closes to the canvas.
 */
export function useGraphSource(graphId: string): GraphSourceApply {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  const commit = useCallback(
    async (text: string) => {
      setPhase({ kind: 'applying' })
      const res = await applyGraphSource(graphId, text)
      if (res.ok) {
        closeOverlay()
        return
      }
      setPhase({ kind: 'errors', errors: res.errors ?? [], message: res.error })
    },
    [graphId],
  )

  const apply = useCallback(
    async (text: string) => {
      setPhase({ kind: 'checking' })
      const res = await applyGraphSource(graphId, text, { dryRun: true })
      if (!res.ok) {
        setPhase({ kind: 'errors', errors: res.errors ?? [], message: res.error })
        return
      }
      const summary = res.summary
      if (summary && isDestructive(summary)) {
        setPhase({ kind: 'confirm', summary })
        return
      }
      await commit(text)
    },
    [graphId, commit],
  )

  const reset = useCallback(() => setPhase({ kind: 'idle' }), [])

  return { phase, apply, confirm: commit, reset }
}
