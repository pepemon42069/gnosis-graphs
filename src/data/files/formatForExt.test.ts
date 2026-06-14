import { describe, expect, it } from 'vitest'
import { formatForExt } from './formatForExt'

describe('formatForExt', () => {
  it('maps markdown extensions to markdown', () => {
    expect(formatForExt('transformers.md')).toEqual({ format: 'markdown' })
    expect(formatForExt('readme.markdown')).toEqual({ format: 'markdown' })
  })

  it('maps code extensions to code + a lowercased language matching detectFormat', () => {
    expect(formatForExt('data.json')).toEqual({ format: 'code', language: 'json' })
    expect(formatForExt('app.py')).toEqual({ format: 'code', language: 'python' })
    expect(formatForExt('mod.ts')).toEqual({ format: 'code', language: 'typescript' })
    expect(formatForExt('main.go')).toEqual({ format: 'code', language: 'go' })
    expect(formatForExt('lib.rs')).toEqual({ format: 'code', language: 'rust' })
    expect(formatForExt('run.sh')).toEqual({ format: 'code', language: 'shell' })
  })

  it('is case-insensitive on the extension', () => {
    expect(formatForExt('Notes.MD')).toEqual({ format: 'markdown' })
    expect(formatForExt('App.PY')).toEqual({ format: 'code', language: 'python' })
  })

  it('falls back to plaintext for an unknown or missing extension', () => {
    expect(formatForExt('mystery.unknownext')).toEqual({ format: 'plaintext' })
    expect(formatForExt('plain')).toEqual({ format: 'plaintext' })
  })
})
