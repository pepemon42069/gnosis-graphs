import { useEffect } from 'react'
import { useSessionStore } from '../app/store'
import type { XY } from '../app/types'
import { fetchGraphData, runCommand } from '../data/client'
import { isTextTarget } from '../keyboard/isTextTarget'
import { nudgePosition } from './spawnPosition'

function asHttpUrl(text: string): boolean {
  if (/\s/.test(text)) return false
  try {
    const url = new URL(text)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function titleFromText(text: string): string {
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean)
  return (line ?? 'Pasted note').slice(0, 80)
}

/** §7 paste capture: URL → link node, text → markdown node titled by its first line. */
export function usePaste(getPastePosition: () => XY): void {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const store = useSessionStore.getState()
      const graphId = store.graphId
      if (!graphId || store.picker || store.confirm) return
      if (isTextTarget(document.activeElement)) return
      const text = e.clipboardData?.getData('text/plain').trim()
      if (!text) return
      e.preventDefault()
      const at = getPastePosition()
      void (async () => {
        const occupied = (await fetchGraphData(graphId)).placements.map((p) => ({ x: p.x, y: p.y }))
        const pos = nudgePosition(at, occupied)
        const args = asHttpUrl(text)
          ? { title: text, link: text, placement: { graphId, ...pos } }
          : {
              title: titleFromText(text),
              file: { filename: 'untitled.md', format: 'markdown', content: text },
              placement: { graphId, ...pos },
            }
        const result = await runCommand('create-node', args)
        useSessionStore.getState().setSelection({ nodeIds: [result.nodeId!], edgeIds: [] })
      })()
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [getPastePosition])
}
