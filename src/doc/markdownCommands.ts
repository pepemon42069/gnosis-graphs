import {
  EditorSelection,
  type EditorState,
  type Line,
  type StateCommand,
  type Transaction,
} from '@codemirror/state'

/**
 * Markdown editing commands for the doc editor toolbar. Imports stay
 * @codemirror/state-only so vitest can run them headless in the node env.
 */

/** Wraps each selection range in `mark`…`mark`; unwraps when already wrapped. */
export function toggleInlineMark(mark: string): StateCommand {
  return ({ state, dispatch }) => {
    const len = mark.length
    const spec = state.changeByRange((range) => {
      const { from, to } = range
      const surrounded =
        from >= len &&
        to + len <= state.doc.length &&
        state.sliceDoc(from - len, from) === mark &&
        state.sliceDoc(to, to + len) === mark
      if (surrounded) {
        return {
          changes: [
            { from: from - len, to: from },
            { from: to, to: to + len },
          ],
          range: EditorSelection.range(from - len, to - len),
        }
      }
      const inner = state.sliceDoc(from, to)
      if (to - from >= 2 * len && inner.startsWith(mark) && inner.endsWith(mark)) {
        return {
          changes: [
            { from, to: from + len },
            { from: to - len, to },
          ],
          range: EditorSelection.range(from, to - 2 * len),
        }
      }
      return {
        changes: [
          { from, insert: mark },
          { from: to, insert: mark },
        ],
        range: EditorSelection.range(from + len, to + len),
      }
    })
    dispatch(state.update(spec, { scrollIntoView: true, userEvent: 'input' }))
    return true
  }
}

/** Wraps each range as [text](url) and selects the url placeholder for typing. */
export const insertLink: StateCommand = ({ state, dispatch }) => {
  const spec = state.changeByRange((range) => {
    const urlStart = range.from + 1 + (range.to - range.from) + 2
    return {
      changes: [
        { from: range.from, insert: '[' },
        { from: range.to, insert: '](url)' },
      ],
      range: EditorSelection.range(urlStart, urlStart + 3),
    }
  })
  dispatch(state.update(spec, { scrollIntoView: true, userEvent: 'input' }))
  return true
}

interface LineEdit {
  from: number
  to?: number
  insert?: string
}

const HEADING_PATTERN = /^#{1,6} /

/** Sets each selected line to an H`level`; a line already at that level loses it. */
export function setHeading(level: number): StateCommand {
  const heading = '#'.repeat(level) + ' '
  return ({ state, dispatch }) => {
    const edits = selectedLines(state).map((line) => {
      const current = HEADING_PATTERN.exec(line.text)?.[0]
      if (current === heading) return { from: line.from, to: line.from + current.length }
      return { from: line.from, to: line.from + (current?.length ?? 0), insert: heading }
    })
    return applyLineEdits(state, dispatch, edits)
  }
}

/**
 * Toggles `prefix` on the selected lines — removed only when every line already
 * carries it (per `match`, for prefixes with variants like checked task boxes).
 */
export function toggleLinePrefix(prefix: string, match?: RegExp): StateCommand {
  return ({ state, dispatch }) => {
    const lines = selectedLines(state)
    const matched = lines.map((line) =>
      match ? match.exec(line.text)?.[0] : line.text.startsWith(prefix) ? prefix : undefined,
    )
    const allMatch = matched.every((m) => m !== undefined)
    const edits = lines.flatMap((line, i): LineEdit[] => {
      const current = matched[i]
      if (allMatch && current !== undefined) {
        return [{ from: line.from, to: line.from + current.length }]
      }
      if (!allMatch && current === undefined) return [{ from: line.from, insert: prefix }]
      return []
    })
    return applyLineEdits(state, dispatch, edits)
  }
}

const ORDERED_PATTERN = /^\d+\. /

/** Numbers the selected lines 1., 2., … — numbering removed when all carry it. */
export const toggleOrderedList: StateCommand = ({ state, dispatch }) => {
  const lines = selectedLines(state)
  const matched = lines.map((line) => ORDERED_PATTERN.exec(line.text)?.[0])
  const allMatch = matched.every((m) => m !== undefined)
  const edits = lines.flatMap((line, i): LineEdit[] => {
    const current = matched[i]
    if (allMatch && current !== undefined) {
      return [{ from: line.from, to: line.from + current.length }]
    }
    if (!allMatch) {
      const insert = `${i + 1}. `
      return current === undefined
        ? [{ from: line.from, insert }]
        : [{ from: line.from, to: line.from + current.length, insert }]
    }
    return []
  })
  return applyLineEdits(state, dispatch, edits)
}

/** Distinct lines touched by any selection range, in document order. */
function selectedLines(state: EditorState): Line[] {
  const byNumber = new Map<number, Line>()
  for (const range of state.selection.ranges) {
    const last = state.doc.lineAt(range.to).number
    for (let n = state.doc.lineAt(range.from).number; n <= last; n++) {
      byNumber.set(n, state.doc.line(n))
    }
  }
  return [...byNumber.values()]
}

function applyLineEdits(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  edits: LineEdit[],
): boolean {
  if (edits.length === 0) return false
  const changes = state.changes(edits)
  // Mapping the existing selection through the ChangeSet keeps every cursor
  // (multi-range included) in place without per-edit shift accounting.
  dispatch(
    state.update({
      changes,
      selection: state.selection.map(changes),
      scrollIntoView: true,
      userEvent: 'input',
    }),
  )
  return true
}
