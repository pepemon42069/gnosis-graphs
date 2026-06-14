import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { classHighlighter, highlightCode } from '@lezer/highlight'
import { useEffect, useState, type ReactNode } from 'react'

/**
 * Static syntax highlighting for previews: the same lezer parsers the editor
 * uses, emitted as tok-* spans colored by the --code-* variables (index.css).
 * Lazy-imported — pulls the CM language graph, so it must stay out of the
 * eager chunk. Renders the plain text until (or unless) the parse lands.
 */
export default function HighlightedCode({ code, language }: { code: string; language: string }) {
  const [spans, setSpans] = useState<ReactNode[] | null>(null)

  useEffect(() => {
    let stale = false
    void (async () => {
      const description = LanguageDescription.matchLanguageName(languages, language, true)
      if (!description) {
        if (!stale) setSpans(null)
        return
      }
      const support = await description.load()
      const tree = support.language.parser.parse(code)
      const out: ReactNode[] = []
      let key = 0
      highlightCode(
        code,
        tree,
        classHighlighter,
        (text, classes) => {
          out.push(
            classes ? (
              <span key={key++} className={classes}>
                {text}
              </span>
            ) : (
              text
            ),
          )
        },
        () => out.push('\n'),
      )
      if (!stale) setSpans(out)
    })()
    return () => {
      stale = true
    }
  }, [code, language])

  return <>{spans ?? code}</>
}
