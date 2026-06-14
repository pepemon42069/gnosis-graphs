import type { WorkspaceBundle } from '../types'

/** Browser-only: save a bundle to disk. Kept out of exportBundle.ts so the
 *  server's import graph (which pulls in exportBundle) never references `document`. */
export function downloadBundle(bundle: WorkspaceBundle): void {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `gnosis-workspace-${bundle.exportedAt.slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
