import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useSessionStore } from '../app/store'
import { VOCAB_NAME_MAX_LENGTH } from '../data/commands/integrity'
import { Icon } from '../ui/Icon'
import { usePickerActions } from './usePickerActions'
import { usePickerResults, type PickerRow } from './usePickerResults'
import './picker.css'

export function Picker() {
  const mode = useSessionStore((s) => s.picker?.mode ?? null)
  if (!mode) return null
  // Remount per mode: query and cursor reset when the edge gesture advances stages.
  return <PickerPalette key={mode} mode={mode} />
}

function PickerPalette({ mode }: { mode: 'command' | 'node' | 'relationType' }) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const { rows, defaultIndex } = usePickerResults(query)
  const { activate, cancel } = usePickerActions()

  // Held/auto-repeated Enter must not double-dispatch the async activation.
  const run = (row: PickerRow) => {
    if (busy) return
    setBusy(true)
    void activate(row).finally(() => setBusy(false))
  }

  const activeIndex = rows.length ? Math.min(cursor ?? defaultIndex, rows.length - 1) : -1

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault()
        e.stopPropagation()
        if (!rows.length) return
        const delta = e.key === 'ArrowDown' ? 1 : -1
        setCursor((activeIndex + delta + rows.length) % rows.length)
        break
      }
      case 'Enter': {
        e.preventDefault()
        e.stopPropagation()
        const row = rows[activeIndex]
        if (row) run(row)
        break
      }
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        cancel()
        break
    }
  }

  return (
    <div
      className="picker-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel()
      }}
    >
      <div className="picker-palette">
        <div className="picker-search">
          <span className="picker-search-icon">
            <Icon name="search" size={16} />
          </span>
          <input
            className="picker-input"
            autoFocus
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-haspopup="listbox"
            aria-autocomplete="list"
            aria-controls="picker-listbox"
            aria-label={
              mode === 'command'
                ? 'Search nodes and graphs'
                : mode === 'node'
                  ? 'Search or create a node'
                  : 'Relation type'
            }
            // Relation-type mode names a relation from the query — cap it like the
            // settings inputs; node/command modes search or name nodes (unbounded).
            maxLength={mode === 'relationType' ? VOCAB_NAME_MAX_LENGTH : undefined}
            value={query}
            placeholder={
              mode === 'command'
                ? 'Search nodes and graphs…'
                : mode === 'node'
                  ? 'Search or create a node…'
                  : 'Relation type…'
            }
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(null)
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        {rows.length > 0 && (
          <div className="picker-rows" id="picker-listbox" role="listbox" ref={listRef}>
            {rows.map((row, i) => (
              <button
                key={row.key}
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                className={rowClass(row, i === activeIndex)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(row)}
              >
                <RowContent row={row} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function rowClass(row: PickerRow, active: boolean): string {
  let cls = 'picker-row'
  if (row.kind === 'createNode' || row.kind === 'createRelationType') cls += ' picker-row--create'
  if (active) cls += ' picker-row--active'
  return cls
}

function RowContent({ row }: { row: PickerRow }) {
  switch (row.kind) {
    case 'node':
      return (
        <>
          {row.icon && <span className="picker-row-icon">{row.icon}</span>}
          <span className="picker-row-title">{row.title}</span>
          <span className="picker-row-type">{row.hint ?? 'node'}</span>
        </>
      )
    case 'nodePlacement':
      return (
        <>
          <span className="picker-row-title">{row.title}</span>
          <span className="picker-row-type">in {row.graphName}</span>
        </>
      )
    case 'graph':
      return (
        <>
          <span className="picker-row-icon">
            <Icon name="folder" size={13} />
          </span>
          <span className="picker-row-title">{row.name}</span>
          <span className="picker-row-type">graph</span>
        </>
      )
    case 'createNode':
      return (
        <>
          <span className="picker-row-title">{`Create "${row.query}"`}</span>
          <span className="picker-row-type">new node</span>
        </>
      )
    case 'relationType':
      return (
        <>
          <span className="picker-row-title">{row.name}</span>
          <span className="picker-row-type">type</span>
        </>
      )
    case 'createRelationType':
      return (
        <>
          <span className="picker-row-title">{`Create type "${row.query}"`}</span>
          <span className="picker-row-type">new type</span>
        </>
      )
  }
}
