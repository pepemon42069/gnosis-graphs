import { useState } from 'react'
import { VOCAB_NAME_MAX_LENGTH } from '../data/commands/integrity'
import { useContentStore } from '../data/react/contentStore'
import { useVocabularyActions } from './useVocabularyActions'
import type { VocabEntry, VocabTab } from './useVocabularyActions'
import { VocabularyRow } from './VocabularyRow'

const HINTS: Record<VocabTab, string> = {
  kind: 'A kind says what sort of thing a node is (paper, person, idea…). Each node carries at most one, shown as the card’s icon and color.',
  relationType:
    'Relation types label edges — what an arrow between two nodes means (cites, contradicts…). Renaming or recoloring updates every edge that uses it.',
}

/** One vocabulary tab's rows (§5); the modal shell lives in SettingsModal. */
export function VocabularyPanel({ tab }: { tab: VocabTab }) {
  const kinds = useContentStore((s) => s.kinds)
  const relationTypes = useContentStore((s) => s.relationTypes)
  const entries: VocabEntry[] = [...(tab === 'kind' ? kinds : relationTypes).values()].sort(
    (a, b) => a.name.localeCompare(b.name),
  )
  return (
    <>
      <p className="settings-hint">{HINTS[tab]}</p>
      {entries.map((entry) => (
        <VocabularyRow
          key={entry.id}
          tab={tab}
          entry={entry}
          others={entries.filter((other) => other.id !== entry.id)}
        />
      ))}
      <AddRow key={tab} tab={tab} />
    </>
  )
}

const DEFAULT_COLOR = '#5b8def'
const DEFAULT_ICON = '•'

function AddRow({ tab }: { tab: VocabTab }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [icon, setIcon] = useState(DEFAULT_ICON)
  const { error, create } = useVocabularyActions(tab)

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (await create(trimmed, color, icon.trim() || DEFAULT_ICON)) setName('')
  }

  return (
    <div className="settings-row settings-row--add">
      <input
        className="ui-input"
        aria-label={tab === 'kind' ? 'New kind name' : 'New relation type name'}
        placeholder={tab === 'kind' ? 'Add kind…' : 'Add relation type…'}
        maxLength={VOCAB_NAME_MAX_LENGTH}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.stopPropagation()
            void submit()
          }
        }}
      />
      <input
        className="settings-color"
        type="color"
        aria-label={tab === 'kind' ? 'New kind color' : 'New relation type color'}
        value={color}
        onChange={(e) => setColor(e.target.value)}
      />
      {tab === 'kind' && (
        <input
          className="settings-icon-input"
          aria-label="New kind icon"
          value={icon}
          maxLength={4}
          onChange={(e) => setIcon(e.target.value)}
        />
      )}
      <button
        type="button"
        className="ui-button"
        disabled={!name.trim()}
        onClick={() => void submit()}
      >
        Add
      </button>
      {error && <span className="settings-error">{error}</span>}
    </div>
  )
}
