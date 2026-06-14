import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import type { FileRecord } from '../types'

/**
 * The filename drives the payload format (D2). CLIENT-ONLY: it pulls
 * @codemirror/language-data, which must stay off the server / commands /
 * bundle import graph — commands and migration use extFor instead.
 */
export function detectFormat(filename: string): {
  format: FileRecord['format']
  language?: string
} {
  if (/\.(md|markdown)$/i.test(filename)) return { format: 'markdown' }
  const match = LanguageDescription.matchFilename(languages, filename)
  if (!match) return { format: 'plaintext' }
  if (match.name === 'Markdown') return { format: 'markdown' }
  return { format: 'code', language: match.name.toLowerCase() }
}
