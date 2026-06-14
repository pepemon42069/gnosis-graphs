import { useEffect, useRef, useState } from 'react'
import { useSessionStore } from '../app/store'
import { runCommand } from '../data/client'

export type VocabTab = 'kind' | 'relationType'

const isMessage = (err: unknown, needle: string) =>
  err instanceof Error && err.message.toLowerCase().includes(needle)

/** Unified row shape: KindRecord and RelationTypeRecord both fit. */
export interface VocabEntry {
  id: string
  name: string
  color?: string
  icon?: string
}

/** Dispatch and error handling for one vocabulary row (or the add row). */
export function useVocabularyActions(tab: VocabTab) {
  const requestConfirm = useSessionStore((s) => s.requestConfirm)
  const [error, setError] = useState<string | null>(null)
  const flashTimer = useRef(0)

  useEffect(() => () => window.clearTimeout(flashTimer.current), [])

  const flash = (message: string) => {
    setError(message)
    window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setError(null), 2500)
  }

  const create = async (name: string, color: string, icon: string): Promise<boolean> => {
    try {
      if (tab === 'kind') await runCommand('create-kind', { name, color, icon })
      else await runCommand('create-relation-type', { name, color })
      return true
    } catch (err) {
      if (isMessage(err, 'already exists')) {
        flash('already exists')
        return false
      }
      throw err
    }
  }

  const rename = async (id: string, name: string): Promise<boolean> => {
    try {
      await runCommand(tab === 'kind' ? 'rename-kind' : 'rename-relation-type', { id, name })
      return true
    } catch (err) {
      if (isMessage(err, 'already exists')) {
        flash('name already exists')
        return false
      }
      throw err
    }
  }

  const recolor = (id: string, color: string) => {
    if (tab === 'kind') void runCommand('recolor-kind', { id, patch: { color } })
    else void runCommand('recolor-relation-type', { id, color })
  }

  const setIcon = (id: string, icon: string) => {
    void runCommand('recolor-kind', { id, patch: { icon } })
  }

  const merge = (from: VocabEntry, into: VocabEntry, usage: number) => {
    const noun = tab === 'kind' ? 'node' : 'edge'
    requestConfirm({
      message: `Merge "${from.name}" into "${into.name}"? ${usage} ${noun}${usage === 1 ? '' : 's'} re-point.`,
      confirmLabel: 'Merge',
      onConfirm: () => {
        void runCommand(tab === 'kind' ? 'merge-kind' : 'merge-relation-type', {
          fromId: from.id,
          intoId: into.id,
        })
      },
    })
  }

  const remove = (entry: VocabEntry) => {
    requestConfirm({
      message: `Delete "${entry.name}"? It is unused, so nothing re-points.`,
      confirmLabel: 'Delete',
      isDanger: true,
      onConfirm: () => {
        runCommand(tab === 'kind' ? 'delete-kind' : 'delete-relation-type', { id: entry.id }).catch(
          (err: unknown) => {
            // §3: only unused entries are deletable; a race can still slip past the disabled button.
            if (isMessage(err, 'in use')) flash('in use — merge instead')
            else throw err
          },
        )
      },
    })
  }

  return { error, create, rename, recolor, setIcon, merge, remove }
}
