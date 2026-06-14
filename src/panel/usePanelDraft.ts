import { useState } from 'react'
import { runCommand } from '../data/client'
import type { NodeMetaPatch } from '../data/commands/nodeCommands'
import type { NodeRecord } from '../data/types'

interface Meta {
  title: string
  summary: string
  kindId: string | null
  tags: string[]
}

export interface PanelDraft extends Meta {
  dirty: boolean
  setTitle(title: string): void
  setSummary(summary: string): void
  setKindId(kindId: string | null): void
  setTags(tags: string[]): void
  /** Two-step commit (§5): every staged field lands as ONE undo-able command. */
  save(): void
}

function fromNode(node: NodeRecord): Meta {
  return {
    title: node.title,
    summary: node.summary ?? '',
    kindId: node.kindId ?? null,
    tags: node.tags,
  }
}

function tagsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag === b[i])
}

function sameMeta(a: Meta, b: Meta): boolean {
  return (
    a.title === b.title &&
    a.summary === b.summary &&
    a.kindId === b.kindId &&
    tagsEqual(a.tags, b.tags)
  )
}

/** Staged metadata form for one node; callers key by node id. */
export function usePanelDraft(node: NodeRecord): PanelDraft {
  const [state, setState] = useState(() => ({ draft: fromNode(node), base: fromNode(node) }))
  const base = fromNode(node)

  // Record changed underneath (our save landing, undo, cross-tab): a clean
  // draft follows along; a dirty one keeps the user's staging.
  if (!sameMeta(state.base, base)) {
    setState({ draft: sameMeta(state.draft, state.base) ? base : state.draft, base })
  }

  const { draft } = state
  const dirty = !sameMeta(draft, base)
  const stage = (patch: Partial<Meta>) =>
    setState((s) => ({ ...s, draft: { ...s.draft, ...patch } }))

  const save = () => {
    const patch: NodeMetaPatch = {}
    const title = draft.title.trim()
    if (title && title !== base.title) patch.title = title
    const summary = draft.summary.trim()
    if (summary !== base.summary) patch.summary = summary
    if (draft.kindId !== base.kindId) patch.kindId = draft.kindId
    if (!tagsEqual(draft.tags, base.tags)) patch.tags = draft.tags
    if (Object.keys(patch).length) {
      void runCommand('update-node-meta', { nodeId: node.id, patch })
      // A blank title is never committed; snap it back so the draft doesn't stay
      // permanently dirty on the title axis after the other fields save.
      if (!title && draft.title !== base.title) {
        setState((s) => ({ ...s, draft: { ...s.draft, title: base.title } }))
      }
    } else if (dirty) setState((s) => ({ ...s, draft: { ...s.base } }))
  }

  return {
    ...draft,
    dirty,
    setTitle: (title) => stage({ title }),
    setSummary: (summary) => stage({ summary }),
    setKindId: (kindId) => stage({ kindId }),
    setTags: (tags) => stage({ tags }),
    save,
  }
}
