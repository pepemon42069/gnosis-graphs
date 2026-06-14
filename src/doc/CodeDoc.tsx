import { useDeferredValue } from 'react'
import { useSessionStore } from '../app/store'
import CodeEditor from '../panel/CodeEditor'
import { PayloadPreview } from '../panel/PayloadPreview'
import { DocStatusBar } from './DocStatusBar'
import { useDocEditor } from './useDocEditor'

interface CodeDocProps {
  fileId: string
  format: 'code' | 'plaintext'
  language: string | undefined
  content: string
}

/**
 * Code/plaintext doc body: gutters and search, edit|preview via CSS-hide
 * (never unmount — see useDocEditor), live preview, footer. Extras are picked
 * from the mount-time format; an in-place flip (structural undo only) keeps them.
 */
export default function CodeDoc({ fileId, format, language, content }: CodeDocProps) {
  const view = useSessionStore((s) => s.payloadView)
  const editor = useDocEditor(format, content, view === 'edit')
  const deferredDoc = useDeferredValue(editor.liveDoc)

  return (
    <div className="doc-editor">
      <div className={`doc-code doc-code--${view}`}>
        <div className="doc-editor-pane">
          <CodeEditor
            fileId={fileId}
            format={format}
            language={language}
            content={content}
            extensions={editor.extensions}
            onReady={editor.onReady}
            onPending={editor.onPending}
          />
        </div>
        {view === 'preview' && (
          <PayloadPreview format={format} language={language} content={deferredDoc} />
        )}
      </div>
      <DocStatusBar doc={deferredDoc} line={editor.line} col={editor.col} pending={editor.pending} />
    </div>
  )
}
