import { useDeferredValue } from 'react'
import { useSessionStore } from '../app/store'
import CodeEditor from '../panel/CodeEditor'
import { PayloadPreview } from '../panel/PayloadPreview'
import { DocStatusBar } from './DocStatusBar'
import { EditorToolbar } from './EditorToolbar'
import { useDocEditor } from './useDocEditor'

/**
 * Markdown doc body: toolbar, write|split|preview panes, live preview, footer.
 * Layout switches CSS-hide panes — the editor stays mounted throughout.
 */
export default function MarkdownDoc({ fileId, content }: { fileId: string; content: string }) {
  const layout = useSessionStore((s) => s.docLayout)
  const grammarCheck = useSessionStore((s) => s.grammarCheck)
  const editor = useDocEditor('markdown', content, layout !== 'preview')
  // Deferred so the markdown re-parse never sits on the keystroke path.
  const deferredDoc = useDeferredValue(editor.liveDoc)

  return (
    <div className="doc-editor">
      {layout !== 'preview' && <EditorToolbar view={editor.view} />}
      <div className={`doc-split doc-split--${layout}`}>
        <div className="doc-editor-pane">
          <CodeEditor
            fileId={fileId}
            format="markdown"
            language={undefined}
            content={content}
            extensions={editor.extensions}
            onReady={editor.onReady}
            onPending={editor.onPending}
            grammarEnabled={grammarCheck}
          />
        </div>
        <PayloadPreview format="markdown" language={undefined} content={deferredDoc} />
      </div>
      <DocStatusBar doc={deferredDoc} line={editor.line} col={editor.col} pending={editor.pending} />
    </div>
  )
}
