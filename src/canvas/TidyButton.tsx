import { useState } from 'react'
import { useSessionStore } from '../app/store'
import type { LayoutStyle } from '../data/graphLayout'
import { Icon } from '../ui/Icon'
import { useTidy } from './useTidy'
import './toolbarMenu.css'

const STYLES: { id: LayoutStyle; label: string; hint: string }[] = [
  { id: 'web', label: 'Web', hint: 'organic · compact' },
  { id: 'flow', label: 'Flow', hint: 'left → right hierarchy' },
]

export function TidyButton() {
  const graphId = useSessionStore((s) => s.graphId)
  return graphId ? <TidyAction graphId={graphId} /> : null
}

function TidyAction({ graphId }: { graphId: string }) {
  const { tidy, running } = useTidy(graphId)
  const [open, setOpen] = useState(false)

  const run = (style: LayoutStyle) => {
    setOpen(false)
    void tidy(style)
  }

  return (
    <div className="toolbar-menu-anchor">
      <button
        type="button"
        className="ui-button ui-button--ghost top-bar-icon"
        aria-label="Tidy layout"
        title="Tidy layout"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={running}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="reload" size={16} />
      </button>
      {open && (
        <>
          <div className="toolbar-menu-backdrop" onMouseDown={() => setOpen(false)} />
          <div className="toolbar-menu" role="menu">
            {STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="menuitem"
                className="toolbar-menu-item toolbar-menu-item--stacked"
                onClick={() => run(s.id)}
              >
                <span className="toolbar-menu-label">{s.label}</span>
                <span className="toolbar-menu-hint">{s.hint}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
