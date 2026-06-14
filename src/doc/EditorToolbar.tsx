import type { StateCommand } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { Icon, type IconName } from '../ui/Icon'
import {
  insertLink,
  setHeading,
  toggleInlineMark,
  toggleLinePrefix,
  toggleOrderedList,
} from './markdownCommands'

const MOD = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+'

interface ToolbarItem {
  label?: string
  icon?: IconName
  title: string
  command: StateCommand
}

const GROUPS: ToolbarItem[][] = [
  [
    { label: 'B', title: `Bold (${MOD}B)`, command: toggleInlineMark('**') },
    { label: 'I', title: `Italic (${MOD}I)`, command: toggleInlineMark('*') },
    { label: 'S', title: 'Strikethrough', command: toggleInlineMark('~~') },
    { label: '`', title: 'Inline code', command: toggleInlineMark('`') },
  ],
  [
    { label: 'H1', title: 'Heading 1', command: setHeading(1) },
    { label: 'H2', title: 'Heading 2', command: setHeading(2) },
    { label: 'H3', title: 'Heading 3', command: setHeading(3) },
  ],
  [
    { label: '•', title: 'Bullet list', command: toggleLinePrefix('- ') },
    { label: '1.', title: 'Numbered list', command: toggleOrderedList },
    { label: '☐', title: 'Task list', command: toggleLinePrefix('- [ ] ', /^- \[[ x]\] /) },
    { label: '❝', title: 'Quote', command: toggleLinePrefix('> ') },
  ],
  [{ icon: 'link', title: 'Insert link', command: insertLink }],
]

/** Markdown formatting toolbar; dispatches pure commands on the live view. */
export function EditorToolbar({ view }: { view: EditorView | null }) {
  return (
    <div className="doc-toolbar" role="toolbar" aria-label="Formatting">
      {GROUPS.map((group, i) => (
        <div key={i} className="doc-toolbar-group">
          {group.map(({ label, icon, title, command }) => (
            <button
              key={title}
              type="button"
              className="doc-toolbar-button pixel"
              title={title}
              aria-label={title}
              disabled={!view}
              // Keep focus (and the selection) in the editor through the click.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => view && command(view)}
            >
              {icon ? <Icon name={icon} size={14} /> : label}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
