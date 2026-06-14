import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { indentWithTab } from '@codemirror/commands'
import { bracketMatching, foldGutter } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { type Extension, Prec } from '@codemirror/state'
import {
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { toggleInlineMark } from './markdownCommands'

export type DocKind = 'markdown' | 'code' | 'plaintext'

// Prec.high outranks defaultKeymap, matching lang-markdown's own list keymap.
const formattingKeymap = Prec.high(
  keymap.of([
    { key: 'Mod-b', run: toggleInlineMark('**') },
    { key: 'Mod-i', run: toggleInlineMark('*') },
  ]),
)

/**
 * Doc-page editor extras — the "full editor" layer the panel's quick strip
 * skips. The only module importing the heavy CM packages; must stay reachable
 * solely from the lazy doc bodies or the main chunk swallows CodeMirror.
 */
export function buildDocExtensions(kind: DocKind): Extension {
  const shared: Extension = [
    // Top panel: the bottom slot would sit on the doc status bar.
    search({ top: true }),
    keymap.of(searchKeymap),
    highlightSelectionMatches(),
    keymap.of([indentWithTab]),
  ]
  if (kind === 'markdown') return [shared, formattingKeymap]
  const lined: Extension = [shared, lineNumbers(), highlightActiveLine(), highlightActiveLineGutter()]
  // Plaintext stops here: auto-paired quotes annoy prose and nothing folds.
  if (kind === 'plaintext') return lined
  return [
    lined,
    foldGutter(),
    bracketMatching(),
    closeBrackets(),
    // Above defaultKeymap so pair-aware Backspace wins over deleteCharBackward.
    Prec.high(keymap.of(closeBracketsKeymap)),
  ]
}
