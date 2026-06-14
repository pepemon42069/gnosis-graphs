import { linter, type Diagnostic } from '@codemirror/lint'
import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { Linter } from 'harper.js'

// Harper ships its grammar engine as a WASM core. Import it dynamically inside
// the lint source so the binary lands in its own lazy chunk — loaded once, on
// the first lint after the toggle flips on, never in the doc/main bundle.
let instance: Promise<Linter> | undefined

function getLinter(): Promise<Linter> {
  if (!instance) {
    instance = (async () => {
      const [{ LocalLinter }, { binaryInlined }] = await Promise.all([
        import('harper.js'),
        import('harper.js/binaryInlined'),
      ])
      const linter = new LocalLinter({ binary: binaryInlined })
      await linter.setup()
      return linter
    })()
  }
  return instance
}

const DEBOUNCE_MS = 500

// Suggestion.kind() — mirrored here so reading it stays off the static-import
// path that would un-lazy the WASM chunk (0 Replace, 1 Remove, 2 InsertAfter).
const INSERT_AFTER = 2
const REMOVE = 1

/**
 * Harper grammar/spell/style diagnostics for the markdown doc editor: squiggly
 * underlines with hover messages and click-to-apply fixes. Char spans are used
 * as CM offsets directly, matching Harper's own editor integrations (exact for
 * BMP prose; astral characters can shift positions).
 */
export function grammarLinter(): Extension {
  return linter(
    async (view): Promise<Diagnostic[]> => {
      const text = view.state.doc.toString()
      if (!text.trim()) return []
      try {
        const harper = await getLinter()
        const lints = await harper.lint(text, { language: 'markdown' })
        return lints.map((lint): Diagnostic => {
          const span = lint.span()
          const actions = lint.suggestions().map((suggestion) => {
            const kind = Number(suggestion.kind())
            const replacement = suggestion.get_replacement_text()
            return {
              name: kind === REMOVE ? 'Remove' : replacement || 'Fix',
              apply: (target: EditorView, from: number, to: number) =>
                target.dispatch(
                  kind === INSERT_AFTER
                    ? { changes: { from: to, insert: replacement } }
                    : { changes: { from, to, insert: replacement } },
                ),
            }
          })
          return {
            from: span.start,
            to: span.end,
            severity: 'warning',
            source: lint.lint_kind_pretty(),
            message: lint.message(),
            actions,
          }
        })
      } catch {
        return []
      }
    },
    { delay: DEBOUNCE_MS },
  )
}
