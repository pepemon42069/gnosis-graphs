import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { json, jsonParseLinter } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { linter } from '@codemirror/lint'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { useEffect, useRef, useState } from 'react'
import { runCommand } from '../data/client'
import type { PayloadFormat } from '../data/types'
import { grammarLinter } from '../doc/grammarLint'
import { appHighlightStyle } from './codeHighlight'

const SAVE_DELAY_MS = 500

/** JSON keeps its live linter; every other code language lazy-loads from language-data. */
async function loadLanguage(format: PayloadFormat, language: string | undefined): Promise<Extension[]> {
  if (format === 'markdown') return [markdown()]
  if (format !== 'code' || !language) return []
  if (language.toLowerCase() === 'json') return [json(), linter(jsonParseLinter())]
  const description = LanguageDescription.matchLanguageName(languages, language, true)
  return description ? [await description.load()] : []
}

interface CodeEditorProps {
  fileId: string
  format: PayloadFormat
  language: string | undefined
  /** Seeds the initial document only; while mounted the editor is the writer. */
  content: string
  /** Static at mount, like content: extra extensions appended after the base keymaps. */
  extensions?: Extension
  /** Receives the view after creation and null on teardown — for toolbars/focus. */
  onReady?: (view: EditorView | null) => void
  /** true when a save is debounce-pending, false once the write is submitted. */
  onPending?: (pending: boolean) => void
  /** false skips the debounced set-file-content write; the host owns persistence
      (graph-source editor — its text is DSL, applied explicitly, not a file). */
  autoSave?: boolean
  /** Markdown only: toggles Harper's grammar/spell linter in place (no remount). */
  grammarEnabled?: boolean
}

/** The one CodeMirror 6 wrapper, lazy-imported. Keyed by file id in PayloadEditor. */
export default function CodeEditor({
  fileId,
  format,
  language,
  content,
  extensions,
  onReady,
  onPending,
  autoSave = true,
  grammarEnabled = false,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [compartment] = useState(() => new Compartment())
  const [grammarCompartment] = useState(() => new Compartment())
  const seedRef = useRef(content)
  const setupRef = useRef({ extensions, onReady, onPending, autoSave })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const { extensions: extra, onReady, onPending, autoSave } = setupRef.current
    let timer: ReturnType<typeof setTimeout> | undefined
    let pendingDoc: string | null = null
    const flush = () => {
      clearTimeout(timer)
      if (pendingDoc === null) return
      onPending?.(false)
      if (autoSave) void runCommand('set-file-content', { fileId, content: pendingDoc })
      pendingDoc = null
    }
    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: seedRef.current,
        extensions: [
          EditorView.lineWrapping,
          placeholder('Write…'),
          history(),
          // CM owns text-level undo: keymap.of consumes Mod+Z via preventDefault.
          keymap.of([...defaultKeymap, ...historyKeymap]),
          syntaxHighlighting(appHighlightStyle, { fallback: true }),
          compartment.of([]),
          grammarCompartment.of([]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            onPending?.(true)
            pendingDoc = update.state.doc.toString()
            clearTimeout(timer)
            timer = setTimeout(flush, SAVE_DELAY_MS)
          }),
          extra ?? [],
        ],
      }),
    })
    viewRef.current = view
    onReady?.(view)
    // Hard navigations (project open/close reload via location.assign) never
    // unmount React — flush the pending debounce before the page goes away.
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      onReady?.(null)
      flush()
      view.destroy()
      viewRef.current = null
    }
  }, [compartment, grammarCompartment, fileId])

  // Format/language switches reconfigure in place: the document (with any
  // pending unsaved edits) and CM undo history survive, matching "raw content
  // carries over" (§6) without a remount. Loading is async (language-data
  // chunks), so a stale resolve must never clobber a newer pick.
  useEffect(() => {
    let stale = false
    void loadLanguage(format, language).then((extensions) => {
      if (!stale) viewRef.current?.dispatch({ effects: compartment.reconfigure(extensions) })
    })
    return () => {
      stale = true
    }
  }, [format, language, compartment])

  // Toggle Harper in place, like the language switch above: the linter only
  // applies to markdown, and flipping it off clears its diagnostics without
  // touching the document or undo history.
  useEffect(() => {
    const extension = format === 'markdown' && grammarEnabled ? grammarLinter() : []
    viewRef.current?.dispatch({ effects: grammarCompartment.reconfigure(extension) })
  }, [format, grammarEnabled, grammarCompartment])

  return <div ref={containerRef} className="panel-code-editor" />
}
