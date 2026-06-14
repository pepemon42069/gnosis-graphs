import type { EditorView } from '@codemirror/view'
import { useMemo, useRef } from 'react'
import { buildDocExtensions } from '../doc/editorExtensions'
import { closeOverlay } from '../nav/history'
import CodeEditor from '../panel/CodeEditor'
import { Icon } from '../ui/Icon'
import { SourceConfirm } from './SourceConfirm'
import { SourceErrors } from './SourceErrors'
import { useGraphSource } from './useGraphSource'

interface SourceBodyProps {
  graphId: string
  name: string
  source: string
}

/**
 * The graph-source editor body (lazy — owns CodeMirror). Edits the DSL in a
 * plaintext editor (file auto-save off; the text is applied explicitly) and runs
 * the dry-run → confirm-on-destructive → apply flow on Apply.
 */
export default function SourceBody({ graphId, name, source }: SourceBodyProps) {
  const { phase, apply, confirm, reset } = useGraphSource(graphId)
  const viewRef = useRef<EditorView | null>(null)
  const extensions = useMemo(() => buildDocExtensions('plaintext'), [])
  // Read the live document straight off the view at apply time — no per-keystroke
  // listener, and the editor owns the only copy of the text.
  const currentText = () => viewRef.current?.state.doc.toString() ?? source

  const busy = phase.kind === 'checking' || phase.kind === 'applying'

  return (
    <div className="source-page">
      <header className="source-header">
        <button type="button" className="ui-button ui-button--ghost source-back pixel" onClick={closeOverlay}>
          <Icon name="chevron-left" size={14} /> {name}
        </button>
        <span className="source-title pixel-label">Edit source</span>
        <button
          type="button"
          className="ui-button ui-button--primary source-apply pixel"
          disabled={busy}
          onClick={() => void apply(currentText())}
        >
          {busy ? 'Applying…' : 'Apply'}
        </button>
      </header>
      <div className="source-body">
        <div className="source-editor-pane">
          <CodeEditor
            fileId={graphId}
            format="plaintext"
            language={undefined}
            content={source}
            extensions={extensions}
            onReady={(v) => (viewRef.current = v)}
            autoSave={false}
          />
        </div>
        {phase.kind === 'errors' && <SourceErrors errors={phase.errors} message={phase.message} />}
        {phase.kind === 'confirm' && (
          <SourceConfirm
            summary={phase.summary}
            onCancel={reset}
            onConfirm={() => void confirm(currentText())}
          />
        )}
      </div>
    </div>
  )
}
