import type { SourceError } from '../data/client'

/** Inline, line-anchored parse/plan errors from a failed apply or dry-run. */
export function SourceErrors({ errors, message }: { errors: SourceError[]; message?: string }) {
  return (
    <aside className="source-panel source-panel--error" role="alert">
      <h2 className="ui-section-label">Cannot apply</h2>
      {message && <p className="source-message">{message}</p>}
      {errors.length > 0 && (
        <ul className="source-error-list">
          {errors.map((e, i) => (
            <li key={`${e.line}-${i}`} className="source-error">
              <span className="source-error-line">Line {e.line}</span>
              <span className="source-error-message">{e.message}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
