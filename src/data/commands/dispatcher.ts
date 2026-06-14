import { getDb } from '../db'
import { emitCommand } from '../events'
import type { Command } from './types'

const UNDO_CAP = 100

const undoStack: Command[] = []
const redoStack: Command[] = []

async function run(command: Command, direction: 'do' | 'undo'): Promise<void> {
  const db = getDb()
  const events = await db.transaction(() =>
    direction === 'do' ? command.do(db) : command.undo(db),
  )
  emitCommand({
    label: command.label,
    transient: command.transient ?? false,
    cascade: command.cascade ?? false,
    events,
  })
}

export async function dispatch(command: Command): Promise<void> {
  await run(command, 'do')
  if (command.transient) return
  undoStack.push(command)
  if (undoStack.length > UNDO_CAP) undoStack.shift()
  redoStack.length = 0
}

export async function undo(): Promise<void> {
  const command = undoStack.pop()
  if (!command) return
  await run(command, 'undo')
  redoStack.push(command)
}

export async function redo(): Promise<void> {
  const command = redoStack.pop()
  if (!command) return
  await run(command, 'do')
  undoStack.push(command)
}

export function canUndo(): boolean {
  return undoStack.length > 0
}

export function canRedo(): boolean {
  return redoStack.length > 0
}

export function clearHistory(): void {
  undoStack.length = 0
  redoStack.length = 0
}
