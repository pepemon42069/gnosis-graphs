import { lazy, Suspense } from 'react'
import type { ComponentProps } from 'react'
import type { PayloadFormat } from '../data/types'

const Markdown = lazy(() => import('react-markdown'))
// Pulls the CM language graph — must never load with the eager chunk.
const HighlightedCode = lazy(() => import('./HighlightedCode'))

type MarkdownComponents = ComponentProps<typeof Markdown>['components']

/** Fenced blocks with a language get the editor's syntax colors. */
const markdownComponents: MarkdownComponents = {
  code({ className, children }) {
    const language = /language-(\S+)/.exec(className ?? '')?.[1]
    // children is undefined for an empty fence — String() would print "undefined".
    const code = String(children ?? '')
    if (!language) return <code className={className}>{children}</code>
    return (
      <code className={className}>
        <Suspense fallback={code}>
          <HighlightedCode code={code} language={language} />
        </Suspense>
      </code>
    )
  },
}

interface PayloadPreviewProps {
  format: PayloadFormat
  language: string | undefined
  content: string
}

/** Read-only render of a file's content (§6): the Preview half of the edit/preview toggle. */
export function PayloadPreview({ format, language, content }: PayloadPreviewProps) {
  if (format === 'markdown') {
    return (
      <div className="panel-preview panel-preview-prose">
        <Suspense fallback={null}>
          <Markdown components={markdownComponents}>{content}</Markdown>
        </Suspense>
      </div>
    )
  }
  if (format === 'code') {
    const code = language?.toLowerCase() === 'json' ? prettyJson(content) : content
    return (
      <pre className="panel-preview panel-preview-code">
        <code>
          {language ? (
            <Suspense fallback={code}>
              <HighlightedCode code={code} language={language} />
            </Suspense>
          ) : (
            code
          )}
        </code>
      </pre>
    )
  }
  return <pre className="panel-preview panel-preview-text">{content}</pre>
}

/** Valid JSON pretty-prints; anything else shows as typed. */
function prettyJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2)
  } catch {
    return content
  }
}
