import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useSessionStore } from '../app/store'
import { AppearanceSettings } from './AppearanceSettings'
import { DataSettings } from './DataSettings'
import { StorageSettings } from './StorageSettings'
import { VocabularyPanel } from './VocabularyPanel'
import { Icon } from '../ui/Icon'
import './settings.css'

type SettingsTab = 'appearance' | 'kinds' | 'relationTypes' | 'storage' | 'data'

const CATEGORIES: { tab: SettingsTab; label: string }[] = [
  { tab: 'appearance', label: 'Appearance' },
  { tab: 'kinds', label: 'Kinds' },
  { tab: 'relationTypes', label: 'Relation types' },
  { tab: 'storage', label: 'Storage' },
  { tab: 'data', label: 'Data' },
]

/** §5 application settings surface. Rendered unconditionally; self-gates on settingsOpen. */
export function SettingsModal() {
  const open = useSessionStore((s) => s.settingsOpen)
  if (!open) return null
  return <Modal />
}

function Modal() {
  const setSettingsOpen = useSessionStore((s) => s.setSettingsOpen)
  const [tab, setTab] = useState<SettingsTab>('appearance')
  const close = () => setSettingsOpen(false)

  // Keys stay local to the modal so the global §5 map never sees them; rows
  // consume their own Escape (rename revert) before it reaches here.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (e.key === 'Escape') close()
  }

  return (
    <div className="settings-backdrop" onClick={close} onKeyDown={onKeyDown}>
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <nav className="settings-nav" aria-label="Settings sections">
          {CATEGORIES.map(({ tab: id, label }) => (
            <button
              key={id}
              type="button"
              aria-current={id === tab}
              className={`settings-nav-item pixel${id === tab ? ' settings-nav-item--active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          <header className="settings-content-header">
            <h2 className="settings-content-title pixel-label">
              {CATEGORIES.find((c) => c.tab === tab)?.label}
            </h2>
            <button
              type="button"
              className="ui-button ui-button--ghost"
              aria-label="Close"
              onClick={close}
            >
              <Icon name="close" size={16} />
            </button>
          </header>
          <div className="settings-rows">
            {tab === 'appearance' && <AppearanceSettings />}
            {tab === 'kinds' && <VocabularyPanel tab="kind" />}
            {tab === 'relationTypes' && <VocabularyPanel tab="relationType" />}
            {tab === 'storage' && <StorageSettings />}
            {tab === 'data' && <DataSettings />}
          </div>
        </div>
      </div>
    </div>
  )
}
