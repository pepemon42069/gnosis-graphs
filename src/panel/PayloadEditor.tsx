import { lazy, Suspense } from 'react'
import { useSessionStore } from '../app/store'
import { runCommand, useFile } from '../data/client'
import type { NodeRecord } from '../data/types'
import { LinkEditor } from './LinkEditor'
import { PayloadPreview } from './PayloadPreview'

const CodeEditor = lazy(() => import('./CodeEditor'))

const VIEWS = ['edit', 'preview'] as const

/** Picks the per-format editor (§6). CodeMirror is lazy so the canvas bundle stays light. */
export function PayloadEditor({ node }: { node: NodeRecord }) {
  const view = useSessionStore((s) => s.payloadView)
  const setPayloadView = useSessionStore((s) => s.setPayloadView)
  if (node.payload?.kind === 'link') {
    // The link card already is the preview — no toggle.
    return <LinkEditor key={node.id} nodeId={node.id} title={node.title} url={node.payload.url} />
  }
  if (node.payload?.kind === 'file') {
    return <FilePayload key={node.id} fileId={node.payload.fileId} view={view} setView={setPayloadView} />
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

function FilePayload({
  fileId,
  view,
  setView,
}: {
  fileId: string
  view: (typeof VIEWS)[number]
  setView: (view: (typeof VIEWS)[number]) => void
}) {
  const file = useFile(fileId)
  if (!file) return null
  return (
    <div className="panel-payload">
      {/* Horizontal section bar: splits metadata above from content below. */}
      <div className="panel-payload-bar">
        <span className="panel-prop-label">Content</span>
        <div className="ui-segment pixel panel-view-switch" role="group" aria-label="Payload view">
          {VIEWS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              className={`ui-segment-option${view === option ? ' ui-segment-option--active' : ''}`}
              onClick={() => setView(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      {view === 'preview' ? (
        <PayloadPreview format={file.format} language={file.language} content={file.content} />
      ) : (
        <Suspense fallback={null}>
          <CodeEditor
            key={file.id}
            fileId={file.id}
            format={file.format}
            language={file.language}
            content={file.content}
          />
        </Suspense>
      )}
    </div>
  )
}
