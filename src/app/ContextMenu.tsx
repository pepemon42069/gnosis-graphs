import { useEffect, useMemo } from 'react'
import { runCommand } from '../data/client'
import { useSessionStore } from './store'
import './contextMenu.css'

const MENU_WIDTH = 180

/** Renders the store's contextMenu at its screen point; one instance in App. */
export function ContextMenu() {
  const menu = useSessionStore((s) => s.contextMenu)
  const close = useSessionStore((s) => s.closeContextMenu)
  const nodeIds = useSessionStore((s) => s.selection.nodeIds)
  const clearSelection = useSessionStore((s) => s.clearSelection)
  const requestConfirm = useSessionStore((s) => s.requestConfirm)

  // Capture phase so this Escape never reaches the app's dismissal ladder.
  useEffect(() => {
    if (!menu) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      close()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [menu, close])

  // A multi-node selection gets a destructive "delete everywhere" entry, appended
  // to whatever the opener (the canvas pane menu) supplied.
  const items = useMemo(() => {
    if (!menu) return []
    if (nodeIds.length < 2) return menu.items
    const confirmBulkDelete = () =>
      requestConfirm({
        message: `Delete ${nodeIds.length} nodes from every graph? Their payloads will be lost.`,
        confirmLabel: 'Delete everywhere',
        isDanger: true,
        onConfirm: () => {
          void runCommand('delete-nodes-everywhere', { nodeIds })
          clearSelection()
        },
      })
    return [...menu.items, { label: `Delete ${nodeIds.length} nodes everywhere`, action: confirmBulkDelete }]
  }, [menu, nodeIds, requestConfirm, clearSelection])

  if (!menu) return null
  const left = Math.min(menu.x, window.innerWidth - MENU_WIDTH - 8)
  const top = Math.min(menu.y, window.innerHeight - 8 - items.length * 32)
  return (
    <div
      className="context-menu-backdrop"
      onMouseDown={close}
      onContextMenu={(e) => {
        e.preventDefault()
        close()
      }}
    >
      <div
        className="context-menu"
        role="menu"
        style={{ left, top }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className="context-menu-item"
            onClick={() => {
              close()
              item.action()
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
