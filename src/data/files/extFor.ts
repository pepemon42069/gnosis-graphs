import type { FileRecord } from '../types'

// Inverse of formatForExt's language map — keep both in sync so a file minted
// from source keeps its extension through a migration / FS-mirror round-trip.
const CODE_EXTS: Record<string, string> = {
  json: 'json',
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  sql: 'sql',
  html: 'html',
  css: 'css',
  yaml: 'yaml',
  rust: 'rs',
  go: 'go',
  shell: 'sh',
  c: 'c',
  'c++': 'cpp',
  java: 'java',
  ruby: 'rb',
  php: 'php',
  xml: 'xml',
  toml: 'toml',
}

/** Filename extension for a stored file, used by migration and the FS mirror. */
export function extFor(format: FileRecord['format'], language?: string): string {
  if (format === 'markdown') return 'md'
  if (format === 'code' && language) return CODE_EXTS[language] ?? 'txt'
  return 'txt'
}
