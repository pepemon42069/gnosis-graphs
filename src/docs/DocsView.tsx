import { closeOverlay } from '../nav/history'
import { Icon } from '../ui/Icon'
import './docs.css'

/**
 * Full-page documentation viewer: embeds the built VitePress site (served by the
 * app's own server at /docs) in an iframe, so the docs are read inside the app
 * with their own search/nav/theme. Back returns to the canvas (closeOverlay).
 */
export function DocsView() {
  return (
    <div className="docs-view">
      <header className="docs-view-header">
        <button
          type="button"
          className="ui-button ui-button--ghost docs-view-back pixel"
          aria-label="Back"
          onClick={closeOverlay}
        >
          <Icon name="chevron-left" size={16} />
          Back
        </button>
        <span className="docs-view-title pixel-label">Documentation</span>
      </header>
      <iframe className="docs-frame" src="/docs/" title="Documentation" />
    </div>
  )
}
