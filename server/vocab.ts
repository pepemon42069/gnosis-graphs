import { findVocabByNameCI } from '../src/data/commands/integrity'
import type { Command } from '../src/data/commands/types'
import type { GnosisDB } from '../src/data/db'

/**
 * Resolve a set of vocab names to ids inside a composite's transaction, creating
 * any that are missing INLINE — never `ensureKind`/`ensureRelationType`, which
 * open their own txn + push their own undo step (atomicity rule). Lookup is
 * case-insensitive, so a name matching existing vocab selects it instead of
 * duplicating. Each created command is fed through `run` so it joins the
 * composite's `executed[]` and is undone with it. Returns a lowercased-name → id map.
 */
export async function ensureVocabInline<C extends Command>(
  table: GnosisDB['kinds'] | GnosisDB['relationTypes'],
  names: string[],
  factory: (name: string) => C,
  idOf: (c: C) => string,
  run: (c: Command) => Promise<void>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const row of await table.toArray()) out.set(row.name.toLowerCase(), row.id)
  for (const name of names) {
    if (out.has(name.toLowerCase())) continue
    const existing = await findVocabByNameCI(table, name)
    if (existing) {
      out.set(name.toLowerCase(), existing.id)
      continue
    }
    const command = factory(name)
    await run(command)
    out.set(name.toLowerCase(), idOf(command))
  }
  return out
}
