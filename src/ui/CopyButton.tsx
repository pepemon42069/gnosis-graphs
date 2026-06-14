import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

/** Copies text to the clipboard, flashing a check to confirm. */
export function CopyButton({ content, label = 'Copy contents' }: { content: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content)
    } catch {
      return
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1200)
  }
  return (
    <button
      type="button"
      className={`ui-icon-button${copied ? ' ui-icon-button--copied' : ''}`}
      aria-label={label}
      title={copied ? 'Copied' : label}
      onClick={copy}
    >
      <Icon name={copied ? 'check' : 'copy'} size={16} />
    </button>
  )
}
