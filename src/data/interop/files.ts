import { strToU8, zipSync } from 'fflate'

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function zipFiles(files: Map<string, string>): Blob {
  const entries: Record<string, Uint8Array> = {}
  for (const [name, content] of files) entries[name] = strToU8(content)
  return new Blob([zipSync(entries)], { type: 'application/zip' })
}
