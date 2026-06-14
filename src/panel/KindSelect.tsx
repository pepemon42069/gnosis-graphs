import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { ensureVocab } from '../data/client'
import { useContentStore } from '../data/react/contentStore'
import { useRevertibleInput } from './useTitleCommit'

const NEW_KIND = '__new-kind__'

/**
 * Controlled: the picked kind stages into the panel draft (§5 two-step save).
 * "New kind…" still creates the vocabulary entry immediately — only the
 * node's assignment waits for Save.
 */
export function KindSelect({
  kindId,
  onChange,
}: {
  kindId: string | null
  onChange: (kindId: string | null) => void
}) {
  const kinds = useContentStore((s) => s.kinds)
  const [creating, setCreating] = useState(false)

  const onSelect = (e: ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value
    if (value === NEW_KIND) setCreating(true)
    else onChange(value || null)
  }

  const { draft, setDraft, onBlur, onKeyDown } = useRevertibleInput(
    '',
    (next, set) => {
      const name = next.trim()
      setCreating(false)
      set('')
      // ensureKind: a CI name match selects the existing kind instead of duplicating (§3).
      if (name) void ensureVocab('kind', name).then((id) => onChange(id))
    },
    { onRevert: () => setCreating(false) },
  )

  if (creating) {
    return (
      <input
        className="panel-kind-input"
        autoFocus
        aria-label="New kind name"
        placeholder="New kind name…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      />
    )
  }

  return (
    <select className="panel-kind-select" aria-label="Kind" value={kindId ?? ''} onChange={onSelect}>
      <option value="">None</option>
      {[...kinds.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((kind) => (
          <option key={kind.id} value={kind.id}>
            {kind.icon} {kind.name}
          </option>
        ))}
      <option value={NEW_KIND}>New kind…</option>
    </select>
  )
}
