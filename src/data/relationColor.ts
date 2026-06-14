// A relation type always carries a color (like a kind). Names have no fixed
// vocabulary, so the color is derived deterministically from the name rather
// than from a preset table — same name, same hue, on every path that creates a
// relation inline (picker, DSL, decompose) and when backfilling older rows.
// Pure — no DB import. Palette mirrors the seed's muted relation hues.

const RELATION_COLORS = [
  '#8a8f98',
  '#4caf7d',
  '#5b8def',
  '#e05d5d',
  '#e0a458',
  '#8e7cc3',
  '#3fb6a8',
  '#c264a6',
]

/** Deterministic color for a relation-type name (case-insensitive). */
export function relationColor(name: string): string {
  const key = name.trim().toLowerCase()
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0
  return RELATION_COLORS[Math.abs(hash) % RELATION_COLORS.length]!
}
