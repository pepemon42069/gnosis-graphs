import { useId } from 'react'
import './infoTip.css'

interface InfoTipProps {
  text: string
  /** Which way the bubble grows, to stay clear of the nearest edge. */
  side?: 'left' | 'right'
}

/** A ⓘ concept hint: CSS-only bubble on hover/focus, no positioning library. */
export function InfoTip({ text, side = 'right' }: InfoTipProps) {
  const id = useId()
  return (
    <span className={`info-tip info-tip--${side}`}>
      <button
        type="button"
        className="info-tip-button"
        aria-label="More information"
        aria-describedby={id}
      >
        ⓘ
      </button>
      <span id={id} className="info-tip-bubble" role="tooltip">
        {text}
      </span>
    </span>
  )
}
