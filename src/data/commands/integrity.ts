import type { Table } from '../db'

/** Max length for a kind / relation-type name — enforced on the name inputs. */
export const VOCAB_NAME_MAX_LENGTH = 32

export class PlacementExistsError extends Error {
  readonly existingPlacementId: string

  constructor(existingPlacementId: string) {
    super('Node is already placed in this graph')
    this.existingPlacementId = existingPlacementId
  }
}

export class EmptyTitleError extends Error {
  constructor() {
    super('Node title must not be empty')
  }
}

export class DuplicateNameError extends Error {
  readonly existingId: string

  constructor(existingId: string) {
    super('An entry with this name already exists')
    this.existingId = existingId
  }
}

export class VocabInUseError extends Error {
  readonly count: number

  constructor(count: number) {
    super('Entry is in use and cannot be deleted')
    this.count = count
  }
}

export class HomeDeletionError extends Error {
  constructor() {
    super('The root graph cannot be deleted')
  }
}

export function requireNonEmptyTitle(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) throw new EmptyTitleError()
  return trimmed
}

export function findVocabByNameCI<T extends { name: string }>(
  table: Table<T, string>,
  name: string,
): Promise<T | undefined> {
  const needle = name.trim().toLowerCase()
  return table.filter((row) => row.name.toLowerCase() === needle).first()
}
