import { useMemo } from 'react'

interface DocStatusBarProps {
  doc: string
  line: number
  col: number
  pending: boolean
}

/** Doc-page footer: counts, cursor position, save state. */
export function DocStatusBar({ doc, line, col, pending }: DocStatusBarProps) {
  const words = useMemo(() => (doc.match(/\S+/g) ?? []).length, [doc])
  return (
    <footer className="doc-statusbar">
      <span>{words} words</span>
      <span>{doc.length} chars</span>
      <span>
        Ln {line}, Col {col}
      </span>
      <span className={`doc-statusbar-save${pending ? ' doc-statusbar-save--pending' : ''}`}>
        {pending ? 'unsaved' : 'saved'}
      </span>
    </footer>
  )
}
