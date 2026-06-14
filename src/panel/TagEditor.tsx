import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Icon } from '../ui/Icon'

/** Controlled: chip edits stage into the panel draft (§5 two-step save). */
export function TagEditor({
  tags,
  onChange,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
}) {
  const [draft, setDraft] = useState('')

  const addTag = () => {
    const tag = draft.trim()
    setDraft('')
    // Dedupe is case-sensitive: "Foo" and "foo" are distinct tags.
    if (!tag || tags.includes(tag)) return
    onChange([...tags, tag])
  }

  const removeTag = (tag: string) => onChange(tags.filter((t) => t !== tag))

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      e.stopPropagation()
      addTag()
    } else if (e.key === 'Backspace' && draft === '') {
      const last = tags[tags.length - 1]
      if (last !== undefined) {
        e.stopPropagation()
        removeTag(last)
      }
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      e.currentTarget.blur()
    }
  }

  return (
    <div className="panel-tags" aria-label="Tags">
      {tags.map((tag) => (
        <span key={tag} className="panel-tag-chip">
          {tag}
          <button
            type="button"
            className="panel-tag-remove"
            aria-label={`Remove tag ${tag}`}
            onClick={() => removeTag(tag)}
          >
            <Icon name="close" size={10} />
          </button>
        </span>
      ))}
      <input
        className="panel-tag-input"
        aria-label="Add tag"
        placeholder={tags.length ? '' : 'Add tag…'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}
