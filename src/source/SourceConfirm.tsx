import type { SourceSummary } from '../data/client'

interface SourceConfirmProps {
  summary: SourceSummary
  onCancel(): void
  onConfirm(): void
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/**
 * Destructive-apply gate: lists exactly what the apply removes (placements off
 * this canvas) and deletes (nodes now unplaced everywhere, with their files)
 * before committing. Shown only when the dry-run reports removals/deletions.
 */
export function SourceConfirm({ summary, onCancel, onConfirm }: SourceConfirmProps) {
  return (
    <aside className="source-panel source-panel--confirm" role="alertdialog" aria-modal="false">
      <h2 className="ui-section-label">This apply is destructive</h2>
      <ul className="source-confirm-list">
        {summary.placementsRemoved > 0 && (
          <li>Remove {plural(summary.placementsRemoved, 'node')} from this graph</li>
        )}
        {summary.nodesDeleted > 0 && (
          <li>
            Delete {plural(summary.nodesDeleted, 'node')} globally (unplaced everywhere — their files
            go too)
          </li>
        )}
      </ul>
      <div className="source-confirm-actions">
        <button type="button" className="ui-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="ui-button ui-button--danger" onClick={onConfirm}>
          Apply anyway
        </button>
      </div>
    </aside>
  )
}
