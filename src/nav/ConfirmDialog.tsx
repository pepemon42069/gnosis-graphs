import type { KeyboardEvent } from 'react'
import { useSessionStore } from '../app/store'
import './nav.css'

export function ConfirmDialog() {
  const confirm = useSessionStore((s) => s.confirm)
  const clearConfirm = useSessionStore((s) => s.clearConfirm)
  if (!confirm) return null

  const accept = () => {
    confirm.onConfirm()
    clearConfirm()
  }

  // A focused button already turns Enter into a native click; only intercept Enter
  // elsewhere so confirm never fires twice. stopPropagation keeps keys off the canvas.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (e.key === 'Escape') clearConfirm()
    else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) accept()
  }

  return (
    <div className="confirm-backdrop" onClick={clearConfirm} onKeyDown={onKeyDown}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-message"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="confirm-message" className="confirm-message">
          {confirm.message}
        </p>
        <div className="confirm-actions">
          <button type="button" className="ui-button" onClick={clearConfirm}>
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            className={`ui-button confirm-accept ${
              confirm.isDanger ? 'ui-button--danger' : 'ui-button--primary'
            }`}
            onClick={accept}
          >
            {confirm.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
