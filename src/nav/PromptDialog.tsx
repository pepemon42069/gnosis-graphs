import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { useSessionStore } from '../app/store'
import './nav.css'

export function PromptDialog() {
  const prompt = useSessionStore((s) => s.prompt)
  const clearPrompt = useSessionStore((s) => s.clearPrompt)
  // Keyed by message so a fresh prompt resets the field even while one is open.
  return prompt ? <PromptForm key={prompt.message} {...{ prompt, clearPrompt }} /> : null
}

function PromptForm({
  prompt,
  clearPrompt,
}: {
  prompt: NonNullable<ReturnType<typeof useSessionStore.getState>['prompt']>
  clearPrompt: () => void
}) {
  const [value, setValue] = useState(prompt.initialValue ?? '')
  const trimmed = value.trim()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!trimmed) return
    prompt.onSubmit(trimmed)
    clearPrompt()
  }

  // stopPropagation keeps typing off the canvas; Escape cancels (the input has no native Escape).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (e.key === 'Escape') clearPrompt()
  }

  return (
    <div className="confirm-backdrop" onClick={clearPrompt} onKeyDown={onKeyDown}>
      <form
        className="confirm-dialog prompt-dialog"
        aria-modal="true"
        aria-labelledby="prompt-message"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <label id="prompt-message" className="confirm-message" htmlFor="prompt-input">
          {prompt.message}
        </label>
        <input
          id="prompt-input"
          className="ui-input pixel prompt-input"
          autoFocus
          value={value}
          placeholder={prompt.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.target.select()}
        />
        <div className="confirm-actions">
          <button type="button" className="ui-button" onClick={clearPrompt}>
            Cancel
          </button>
          <button type="submit" className="ui-button confirm-accept ui-button--primary" disabled={!trimmed}>
            {prompt.submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
