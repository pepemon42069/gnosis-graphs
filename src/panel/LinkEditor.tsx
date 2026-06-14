import { runCommand } from '../data/client'
import { useRevertibleInput } from './useTitleCommit'

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

interface LinkEditorProps {
  nodeId: string
  title: string
  url: string
}

/** URL field plus a title + domain preview card (§6). Never fetches anything. */
export function LinkEditor({ nodeId, title, url }: LinkEditorProps) {
  const { draft, setDraft, onBlur, onKeyDown } = useRevertibleInput(url, (next) => {
    if (next !== url) void runCommand('set-node-link', { nodeId, url: next })
  })

  const hostname = hostnameOf(url)
  return (
    <div className="panel-link-editor">
      <input
        className="panel-link-input"
        type="url"
        placeholder="https://…"
        aria-label="Link URL"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      />
      {hostname !== null && (
        <div className="panel-link-card">
          <div className="panel-link-card-title">{title}</div>
          <div className="panel-link-card-domain">{hostname}</div>
        </div>
      )}
    </div>
  )
}
