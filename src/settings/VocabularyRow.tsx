import { useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useSessionStore } from '../app/store'
import { Icon } from '../ui/Icon'
import { VOCAB_NAME_MAX_LENGTH } from '../data/commands/integrity'
import { useUsage } from '../data/client'
import { useRevertibleInput } from '../panel/useTitleCommit'
import { useVocabularyActions } from './useVocabularyActions'
import type { VocabEntry, VocabTab } from './useVocabularyActions'

const FALLBACK_COLOR = '#8a8f98'

export function VocabularyRow({
  tab,
  entry,
  others,
}: {
  tab: VocabTab
  entry: VocabEntry
  others: VocabEntry[]
}) {
  const [lastName, setLastName] = useState(entry.name)
  const { error, rename, recolor, setIcon, merge, remove } = useVocabularyActions(tab)
  const usage = useUsage(tab === 'kind' ? 'kind' : 'relation-type', entry.id)

  const { draft, setDraft, onBlur, onKeyDown } = useRevertibleInput(entry.name, (next, set) => {
    const trimmed = next.trim()
    if (!trimmed || trimmed === entry.name) {
      set(entry.name)
      return
    }
    set(trimmed)
    void rename(entry.id, trimmed).then((ok) => {
      if (!ok) set(entry.name)
    })
  })

  // Render-time reset when the record changes underneath (undo, merge).
  if (entry.name !== lastName) {
    setLastName(entry.name)
    setDraft(entry.name)
  }

  // Merge targets open as a context menu under the icon (no per-row select).
  const openMergeMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    useSessionStore.getState().openContextMenu({
      x: box.left,
      y: box.bottom + 4,
      items: others.map((other) => ({
        label: `Merge into ${other.name}`,
        action: () => merge(entry, other, usage ?? 0),
      })),
    })
  }

  const inUse = usage === undefined || usage > 0
  const noun = tab === 'kind' ? 'node' : 'edge'

  return (
    <div className="settings-row">
      <input
        className="ui-input settings-name-input"
        aria-label={`${entry.name} name`}
        maxLength={VOCAB_NAME_MAX_LENGTH}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      />
      <span className="settings-usage">
        {usage ?? '–'} {noun}
        {usage === 1 ? '' : 's'}
      </span>
      <div className="settings-row-tools">
        <input
          key={entry.color ?? 'none'}
          className="settings-color"
          type="color"
          aria-label={`${entry.name} color`}
          defaultValue={entry.color ?? FALLBACK_COLOR}
          onBlur={(e) => {
            if (e.target.value !== (entry.color ?? FALLBACK_COLOR))
              recolor(entry.id, e.target.value)
          }}
        />
        {tab === 'kind' && (
          <input
            key={entry.icon}
            className="settings-icon-input"
            aria-label={`${entry.name} icon`}
            defaultValue={entry.icon ?? ''}
            maxLength={4}
            onKeyDown={onKeyDown}
            onBlur={(e) => {
              const next = e.target.value.trim()
              if (next && next !== entry.icon) setIcon(entry.id, next)
              else e.target.value = entry.icon ?? ''
            }}
          />
        )}
        <button
          type="button"
          className="settings-tool"
          aria-label={`Merge ${entry.name} into…`}
          title="Merge into…"
          disabled={others.length === 0}
          onClick={openMergeMenu}
        >
          <Icon name="branch" size={14} />
        </button>
        <button
          type="button"
          className="settings-tool settings-tool--danger"
          aria-label={`Delete ${entry.name}`}
          disabled={inUse}
          title={
            inUse
              ? `In use by ${usage ?? '?'} ${noun}(s) — only unused entries can be deleted (§3); merge first`
              : `Delete "${entry.name}"`
          }
          onClick={() => remove(entry)}
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
      {error && <span className="settings-error">{error}</span>}
    </div>
  )
}
