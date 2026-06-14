import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useEffect, useMemo, useState } from 'react'
import { buildDocExtensions, type DocKind } from './editorExtensions'

export interface DocEditor {
  /** Pass to CodeEditor; static at mount like its content prop. */
  extensions: Extension
  onReady: (view: EditorView | null) => void
  onPending: (pending: boolean) => void
  view: EditorView | null
  /** The document as typed — ahead of the store by up to the save debounce. */
  liveDoc: string
  line: number
  col: number
  pending: boolean
}

/**
 * Wires one doc-page CodeEditor: full-editor extensions plus live document,
 * cursor and save-pending state for the toolbar, preview and status bar.
 * `editorVisible` tracks the CSS-hide layout toggle — the editor never
 * unmounts (a remount races the flush→store round-trip and reseeds stale).
 */
export function useDocEditor(kind: DocKind, content: string, editorVisible: boolean): DocEditor {
  const [view, setView] = useState<EditorView | null>(null)
  const [liveDoc, setLiveDoc] = useState(content)
  const [cursor, setCursor] = useState({ line: 1, col: 1 })
  const [pending, setPending] = useState(false)

  const extensions = useMemo(
    () => [
      buildDocExtensions(kind),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) setLiveDoc(update.state.doc.toString())
        if (update.docChanged || update.selectionSet) {
          const head = update.state.selection.main.head
          const line = update.state.doc.lineAt(head)
          setCursor({ line: line.number, col: head - line.from + 1 })
        }
      }),
    ],
    [kind],
  )

  useEffect(() => {
    if (!view) return
    // A display:none editor still receives keystrokes if it kept focus; one
    // created hidden has zero geometry until measured on first reveal.
    if (editorVisible) view.requestMeasure()
    else view.contentDOM.blur()
  }, [view, editorVisible])

  return { extensions, onReady: setView, onPending: setPending, view, liveDoc, ...cursor, pending }
}
