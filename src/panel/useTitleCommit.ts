import { useRef, useState } from 'react'
import type { Dispatch, KeyboardEvent, SetStateAction } from 'react'
import { runCommand } from '../data/client'

/**
 * Shared "edit text, commit on Enter/blur, revert on Escape" mechanics. The
 * hook owns the draft, the reverting ref, and the Enter/Escape handler; the
 * caller supplies the commit effect (`commit(draft, setDraft)`) and optional
 * extra teardown to run alongside the draft reset on Escape (`onRevert`).
 */
export function useRevertibleInput(
  value: string,
  commit: (draft: string, setDraft: Dispatch<SetStateAction<string>>) => void,
  opts?: { onRevert?: () => void },
) {
  const [draft, setDraft] = useState(value)
  const reverting = useRef(false)

  const onBlur = () => {
    if (reverting.current) {
      reverting.current = false
      setDraft(value)
      opts?.onRevert?.()
      return
    }
    commit(draft, setDraft)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.stopPropagation()
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      reverting.current = true
      e.currentTarget.blur()
    }
  }

  return { draft, setDraft, onBlur, onKeyDown }
}

/**
 * Draft/commit/revert title editing shared by the panel header and the doc
 * page. Callers key their component by node id so the draft resets per node.
 */
export function useTitleCommit(nodeId: string, title: string) {
  const { draft, setDraft, onBlur, onKeyDown } = useRevertibleInput(title, (next, set) => {
    const trimmed = next.trim()
    if (!trimmed) {
      // setNodeTitle throws EmptyTitleError at factory time; a blank edit reverts (§3).
      set(title)
      return
    }
    set(trimmed)
    if (trimmed !== title) void runCommand('set-node-title', { nodeId, title: trimmed })
  })

  return { draft, setDraft, commit: onBlur, onKeyDown }
}
