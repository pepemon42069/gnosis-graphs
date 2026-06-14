import { lazy, Suspense, useEffect, useRef } from 'react'
import { useSessionStore } from '../app/store'
import { runCommand, useFile } from '../data/client'
import { useContentStore } from '../data/react/contentStore'
import type { NodeRecord } from '../data/types'
import { closeOverlay } from '../nav/history'
import { LinkEditor } from '../panel/LinkEditor'
import { useTitleCommit } from '../panel/useTitleCommit'
import { Icon } from '../ui/Icon'
import './doc.css'

// Lazy: these pull the full CodeMirror graph; DocPage itself is in the main chunk.
const MarkdownDoc = lazy(() => import('./MarkdownDoc'))
const CodeDoc = lazy(() => import('./CodeDoc'))

/** Full-page editor for one node (§WS-3); replaces the canvas while a doc route is open. */
export function DocPage({ nodeId }: { nodeId: string }) {
  const node = useContentStore((s) => s.nodes.get(nodeId))
  // On a cold deep-link the content store is still hydrating — a node that was
  // never seen isn't deleted, just not loaded yet (boot already validated it).
  // Only a node that disappears after being seen closes back to its graph.
  const seen = useRef(false)
  useEffect(() => {
    if (node) seen.current = true
    else if (seen.current) closeOverlay()
  }, [node])
  if (!node) return null
  return <DocView key={node.id} node={node} />
}

const LAYOUTS = ['write', 'split', 'preview'] as const

function DocView({ node }: { node: NodeRecord }) {
  const title = useTitleCommit(node.id, node.title)
  const graphId = useSessionStore((s) => s.graphId)
  const graph = useContentStore((s) => (graphId ? s.graphs.get(graphId) : undefined))
  const view = useSessionStore((s) => s.payloadView)
  const setPayloadView = useSessionStore((s) => s.setPayloadView)
  const layout = useSessionStore((s) => s.docLayout)
  const setDocLayout = useSessionStore((s) => s.setDocLayout)
  const file = useFile(node.payload?.kind === 'file' ? node.payload.fileId : null)
  // The file's format picks the body; a link or a still-loading file shows neither switch.
  const format = node.payload?.kind === 'link' ? 'link' : file?.format

  return (
    <div className="doc-page">
      <header className="doc-header">
        <button
          type="button"
          className="ui-button ui-button--ghost pixel doc-back"
          onClick={closeOverlay}
        >
          <Icon name="chevron-left" size={14} /> {graph?.name ?? 'Back'}
        </button>
        <input
          className="doc-title"
          aria-label="Node title"
          value={title.draft}
          onChange={(e) => title.setDraft(e.target.value)}
          onBlur={title.commit}
          onKeyDown={title.onKeyDown}
        />
        {format === 'markdown' && (
          <div className="ui-segment pixel doc-layout-switch" role="group" aria-label="Editor layout">
            {LAYOUTS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={layout === option}
                className={`ui-segment-option${layout === option ? ' ui-segment-option--active' : ''}`}
                onClick={() => setDocLayout(option)}
              >
                {option}
              </button>
            ))}
          </div>
        )}
        {(format === 'code' || format === 'plaintext') && (
          <div className="ui-segment pixel doc-view-switch" role="group" aria-label="Payload view">
            {(['edit', 'preview'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={view === option}
                className={`ui-segment-option${view === option ? ' ui-segment-option--active' : ''}`}
                onClick={() => setPayloadView(option)}
              >
                {option}
              </button>
            ))}
          </div>
        )}
      </header>
      <div className="doc-body">
        {node.payload?.kind === 'link' ? (
          <LinkEditor key={node.id} nodeId={node.id} title={node.title} url={node.payload.url} />
        ) : !node.payload ? (
          <DocEmpty nodeId={node.id} />
        ) : !file ? null : file.format === 'markdown' ? (
          <Suspense fallback={null}>
            <MarkdownDoc fileId={file.id} content={file.content} />
          </Suspense>
        ) : (
          <Suspense fallback={null}>
            <CodeDoc
              fileId={file.id}
              format={file.format}
              language={file.language}
              content={file.content}
            />
          </Suspense>
        )}
      </div>
    </div>
  )
}

/** Doc-page prompt for a file-less node — mints an empty markdown file in place. */
function DocEmpty({ nodeId }: { nodeId: string }) {
  return (
    <div className="doc-empty">
      <p className="doc-empty-text">No file yet.</p>
      <button
        type="button"
        className="ui-button ui-button--primary pixel"
        onClick={() =>
          void runCommand('set-node-file', { nodeId, filename: 'untitled.md', format: 'markdown' })
        }
      >
        Create file
      </button>
    </div>
  )
}
