import { useState, type KeyboardEvent } from 'react'
import { useSessionStore } from '../app/store'
import { runCommand, useFile } from '../data/client'
import { detectFormat } from '../data/files/detectFormat'
import type { NodeRecord } from '../data/types'
import { visitDoc } from '../nav/history'
import { Icon } from '../ui/Icon'
import { AppearsIn } from './AppearsIn'
import { KindSelect } from './KindSelect'
import { TagEditor } from './TagEditor'
import { usePanelDraft } from './usePanelDraft'

const SECTIONS = ['data', 'link'] as const

/** Keyed by node id from SidePanel; all metadata stages until Save (§5). */
export function PanelHeader({ node }: { node: NodeRecord }) {
  const draft = usePanelDraft(node)
  const requestConfirm = useSessionStore((s) => s.requestConfirm)
  const clearSelection = useSessionStore((s) => s.clearSelection)
  // A file-less node matches neither segment — both render unpressed until the
  // user picks one (PayloadEditor shows the create/link empty state below).
  const section = node.payload?.kind === 'link' ? 'link' : node.payload?.kind === 'file' ? 'data' : null

  const blurOnKeys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.stopPropagation()
      e.currentTarget.blur()
    }
  }

  const confirmDelete = () => {
    requestConfirm({
      message: `Delete "${node.title}" from every graph? Its payload will be lost.`,
      confirmLabel: 'Delete everywhere',
      isDanger: true,
      onConfirm: () => {
        void runCommand('delete-node-everywhere', { nodeId: node.id })
        clearSelection()
      },
    })
  }

  const toggle = (option: (typeof SECTIONS)[number]) => {
    if (option === section) return
    if (option === 'link') void runCommand('set-node-link', { nodeId: node.id, url: '' })
    else void runCommand('set-node-file', { nodeId: node.id, filename: 'untitled.md', format: 'markdown' })
  }

  return (
    <header className="panel-header">
      <div className="panel-title-row">
        <input
          className="panel-title-input"
          aria-label="Node title"
          value={draft.title}
          onChange={(e) => draft.setTitle(e.target.value)}
          onKeyDown={blurOnKeys}
        />
        <button
          type="button"
          className="panel-delete-button"
          aria-label="Delete node everywhere"
          title="Delete node everywhere"
          onClick={confirmDelete}
        >
          <Icon name="trash" size={16} />
        </button>
      </div>
      <textarea
        className="panel-summary"
        aria-label="Node summary"
        title="Shown on the graph card — the canvas never shows the content itself"
        placeholder="Summary — shown on the graph card…"
        rows={2}
        value={draft.summary}
        onChange={(e) => draft.setSummary(e.target.value)}
      />
      <div className="panel-prop">
        <span
          className="panel-prop-label"
          title="What sort of thing this node is (paper, person, idea…) — manage the list in Settings"
        >
          Kind
        </span>
        <KindSelect kindId={draft.kindId} onChange={draft.setKindId} />
      </div>
      <div className="panel-prop">
        <span
          className="panel-prop-label"
          title="Free-form labels for grouping and search — Enter adds one, ✕ removes"
        >
          Tags
        </span>
        <TagEditor tags={draft.tags} onChange={draft.setTags} />
      </div>
      <div className="panel-prop">
        <span
          className="panel-prop-label"
          title="Data holds a file — its name picks the format (Markdown, code, plain text). Link renders a link card."
        >
          Format
        </span>
        <div className="panel-format">
          <div className="ui-segment pixel" role="group" aria-label="Payload format">
            {SECTIONS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={section === option}
                className={`ui-segment-option${section === option ? ' ui-segment-option--active' : ''}`}
                onClick={() => toggle(option)}
              >
                {option}
              </button>
            ))}
          </div>
          {section === 'data' && node.payload?.kind === 'file' && (
            <FilenameField fileId={node.payload.fileId} nodeId={node.id} onBlurKeys={blurOnKeys} />
          )}
        </div>
      </div>
      {draft.dirty && (
        <button
          type="button"
          className="ui-button ui-button--primary pixel panel-save-button"
          onClick={draft.save}
        >
          Save changes
        </button>
      )}
      <button
        type="button"
        className="ui-button pixel panel-open-editor"
        aria-label="Open in editor"
        onClick={() => visitDoc(node.id)}
      >
        <Icon name="edit" size={14} /> Open in editor
      </button>
      <AppearsIn nodeId={node.id} />
    </header>
  )
}

/** The file's name drives its format; renaming re-detects it (D2). */
function FilenameField({
  fileId,
  nodeId,
  onBlurKeys,
}: {
  fileId: string
  nodeId: string
  onBlurKeys: (e: KeyboardEvent<HTMLInputElement>) => void
}) {
  const file = useFile(fileId)
  const [draft, setDraft] = useState<string | null>(null)
  const value = draft ?? file?.filename ?? ''

  const commit = () => {
    setDraft(null)
    const filename = value.trim()
    if (!filename || filename === file?.filename) return
    void runCommand('rename-node-file', { nodeId, filename, ...detectFormat(filename) })
  }

  return (
    <input
      className="ui-input pixel panel-filename-input"
      aria-label="File name"
      placeholder="filename.md"
      value={value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onBlurKeys}
    />
  )
}
