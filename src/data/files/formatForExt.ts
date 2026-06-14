import type { FileRecord } from '../types'

/**
 * Filename → payload {format, language} without @codemirror/language-data, so
 * the parser/apply path (server, source layer) stays off that client-only
 * graph. The language names mirror detectFormat's lowercased output so a file
 * minted from source matches one minted from the panel.
 */
const CODE_LANGS: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  py: 'python',
  css: 'css',
  html: 'html',
  htm: 'html',
  rs: 'rust',
  go: 'go',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  yaml: 'yaml',
  yml: 'yaml',
  c: 'c',
  h: 'c',
  cpp: 'c++',
  java: 'java',
  rb: 'ruby',
  php: 'php',
  xml: 'xml',
  toml: 'toml',
}

export function formatForExt(filename: string): {
  format: FileRecord['format']
  language?: string
} {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'md' || ext === 'markdown') return { format: 'markdown' }
  const language = CODE_LANGS[ext]
  if (language) return { format: 'code', language }
  return { format: 'plaintext' }
}
