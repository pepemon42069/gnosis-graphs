import { HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/**
 * Syntax colors via the app's --code-* CSS variables, so highlighting tracks
 * the light/dark theme live — CM's defaultHighlightStyle assumes a light
 * background and goes illegible in dark mode.
 */
export const appHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--code-keyword)' },
  { tag: [t.atom, t.bool, t.number], color: 'var(--code-atom)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--code-string)' },
  { tag: [t.comment, t.meta], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [t.definition(t.name), t.function(t.variableName), t.labelName], color: 'var(--code-def)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--code-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--code-prop)' },
  { tag: t.heading, fontWeight: '600', color: 'var(--code-def)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '600' },
  { tag: [t.link, t.url], color: 'var(--accent)', textDecoration: 'underline' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.invalid, color: 'var(--danger)' },
])
