import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  insertLink,
  setHeading,
  toggleInlineMark,
  toggleLinePrefix,
  toggleOrderedList,
} from './markdownCommands'

function run(doc: string, from: number, to: number, command: StateCommand): EditorState {
  let state = EditorState.create({ doc, selection: EditorSelection.single(from, to) })
  command({
    state,
    dispatch: (tr) => {
      state = tr.state
    },
  })
  return state
}

describe('toggleInlineMark', () => {
  it('wraps a selection and selects the inner text', () => {
    const state = run('hello', 0, 5, toggleInlineMark('**'))
    expect(state.doc.toString()).toBe('**hello**')
    expect([state.selection.main.from, state.selection.main.to]).toEqual([2, 7])
  })

  it('unwraps marks surrounding the selection', () => {
    const state = run('**hello**', 2, 7, toggleInlineMark('**'))
    expect(state.doc.toString()).toBe('hello')
    expect([state.selection.main.from, state.selection.main.to]).toEqual([0, 5])
  })

  it('unwraps marks inside the selection', () => {
    const state = run('**hello**', 0, 9, toggleInlineMark('**'))
    expect(state.doc.toString()).toBe('hello')
    expect([state.selection.main.from, state.selection.main.to]).toEqual([0, 5])
  })

  it('inserts an empty pair at a cursor, parking the cursor between', () => {
    const state = run('ab', 1, 1, toggleInlineMark('*'))
    expect(state.doc.toString()).toBe('a**b')
    expect(state.selection.main.head).toBe(2)
  })
})

describe('setHeading', () => {
  it('adds, switches, and removes the prefix', () => {
    expect(run('title', 0, 0, setHeading(2)).doc.toString()).toBe('## title')
    expect(run('## title', 0, 0, setHeading(1)).doc.toString()).toBe('# title')
    expect(run('# title', 0, 0, setHeading(1)).doc.toString()).toBe('title')
  })
})

describe('toggleLinePrefix', () => {
  it('prefixes every selected line and toggles them back off', () => {
    const on = run('a\nb', 0, 3, toggleLinePrefix('- '))
    expect(on.doc.toString()).toBe('- a\n- b')
    const off = run('- a\n- b', 0, 7, toggleLinePrefix('- '))
    expect(off.doc.toString()).toBe('a\nb')
  })

  it('only removes when every line matches', () => {
    const state = run('- a\nb', 0, 5, toggleLinePrefix('- '))
    expect(state.doc.toString()).toBe('- a\n- b')
  })

  it('recognizes checked task boxes via the matcher', () => {
    const state = run('- [x] done', 0, 0, toggleLinePrefix('- [ ] ', /^- \[[ x]\] /))
    expect(state.doc.toString()).toBe('done')
  })
})

describe('toggleOrderedList', () => {
  it('numbers lines sequentially and removes numbering when all match', () => {
    const on = run('a\nb\nc', 0, 5, toggleOrderedList)
    expect(on.doc.toString()).toBe('1. a\n2. b\n3. c')
    const off = run('1. a\n2. b\n3. c', 0, 14, toggleOrderedList)
    expect(off.doc.toString()).toBe('a\nb\nc')
  })

  it('renumbers partially numbered selections', () => {
    const state = run('5. a\nb', 0, 6, toggleOrderedList)
    expect(state.doc.toString()).toBe('1. a\n2. b')
  })
})

describe('insertLink', () => {
  it('wraps the selection and selects the url placeholder', () => {
    const state = run('hello', 0, 5, insertLink)
    expect(state.doc.toString()).toBe('[hello](url)')
    expect(state.sliceDoc(state.selection.main.from, state.selection.main.to)).toBe('url')
  })
})
