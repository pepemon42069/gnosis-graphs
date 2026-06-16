import { runCommand, useFile } from '../data/client'
import type { NodeRecord } from '../data/types'
import { visitDoc } from '../nav/history'
import { CopyButton } from '../ui/CopyButton'
import { Icon } from '../ui/Icon'
import { LinkEditor } from './LinkEditor'
import { PayloadPreview } from './PayloadPreview'

/** Picks the per-format preview (§6). Editing happens in the full-page doc editor. */
export function PayloadEditor({ node }: { node: NodeRecord }) {
  if (node.payload?.kind === 'link') {
    // The link card already is the preview — no toggle.
    return <LinkEditor key={node.id} nodeId={node.id} title={node.title} url={node.payload.url} />
  }
  if (node.payload?.kind === 'file') {
    return <FilePayload key={node.id} nodeId={node.id} fileId={node.payload.fileId} />
  }
  // No payload yet — offer the two ways to give the node content.
  return <PayloadEmpty key={node.id} nodeId={node.id} />
}

/** Shown for a file-less node: create an empty file, or attach a link. */
function PayloadEmpty({ nodeId }: { nodeId: string }) {
  const createFile = () =>
    void runCommand('set-node-file', { nodeId, filename: 'untitled.md', format: 'markdown' })
  const addLink = (url: string) => void runCommand('set-node-link', { nodeId, url })
  return (
    <div className="panel-empty">
      <p className="panel-empty-text">This node has no content yet.</p>
      <div className="panel-empty-actions">
        <button type="button" className="ui-button ui-button--primary pixel" onClick={createFile}>
          Create file
        </button>
        <input
          className="panel-link-input"
          type="url"
          placeholder="…or paste a link"
          aria-label="Link URL"
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.stopPropagation()
            const url = e.currentTarget.value.trim()
            if (url) addLink(url)
          }}
        />
      </div>
    </div>
  )
}

/** Reading view for a file payload: always previews; editing opens the doc page. */
function FilePayload({ nodeId, fileId }: { nodeId: string; fileId: string }) {
  const file = useFile(fileId)
  if (!file) return null
  return (
    <div className="panel-payload">
      {/* Horizontal section bar: splits metadata above from content below. */}
      <div className="panel-payload-bar">
        <span className="panel-prop-label">Content</span>
        <div className="panel-payload-bar-actions">
          <CopyButton content={file.content} />
          <button
            type="button"
            className="ui-button pixel panel-open-editor"
            aria-label="Edit in editor"
            title="Edit in editor"
            onClick={() => visitDoc(nodeId)}
          >
            <Icon name="edit" size={14} /> edit
          </button>
        </div>
      </div>
      <PayloadPreview format={file.format} language={file.language} content={file.content} />
    </div>
  )
}
