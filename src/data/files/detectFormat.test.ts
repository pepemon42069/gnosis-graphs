import { describe, expect, it } from 'vitest'
import { detectFormat } from './detectFormat'

describe('detectFormat', () => {
  it('maps markdown extensions to markdown', () => {
    expect(detectFormat('notes.md')).toEqual({ format: 'markdown' })
    expect(detectFormat('readme.markdown')).toEqual({ format: 'markdown' })
  })

  it('maps a code language filename to code + lowercased language', () => {
    expect(detectFormat('data.json')).toEqual({ format: 'code', language: 'json' })
    expect(detectFormat('app.py')).toEqual({ format: 'code', language: 'python' })
    expect(detectFormat('script.ts')).toEqual({ format: 'code', language: 'typescript' })
  })

  it('falls back to plaintext for an unknown extension', () => {
    expect(detectFormat('mystery.unknownext')).toEqual({ format: 'plaintext' })
    expect(detectFormat('plain')).toEqual({ format: 'plaintext' })
  })
})
