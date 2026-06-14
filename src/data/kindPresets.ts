// Idiomatic icon + color per kind name, consulted whenever a kind is created
// INLINE (decompose, DSL apply, ensureKind) so auto-made kinds aren't a generic
// gray ◆. Colors stay within the seed's muted palette; an unknown name keeps the
// neutral fallback. Pure — no DB import.

const KIND_FALLBACK = { color: '#8a8f98', icon: '◆' }

const KIND_PRESETS: Record<string, { color: string; icon: string }> = {
  concept: { color: '#5b8def', icon: '💡' },
  idea: { color: '#5b8def', icon: '💡' },
  definition: { color: '#5b8def', icon: '📖' },
  claim: { color: '#e0a458', icon: '💬' },
  question: { color: '#e0a458', icon: '❓' },
  example: { color: '#4caf7d', icon: '🧪' },
  decision: { color: '#4caf7d', icon: '⚖️' },
  task: { color: '#4caf7d', icon: '✅' },
  learning: { color: '#3fb6a8', icon: '🧠' },
  method: { color: '#7c8aa0', icon: '⚙️' },
  mechanism: { color: '#7c8aa0', icon: '⚙️' },
  principle: { color: '#c264a6', icon: '🧭' },
  cut: { color: '#c2685f', icon: '✂️' },
  person: { color: '#b08968', icon: '👤' },
  paper: { color: '#b08968', icon: '📄' },
  reference: { color: '#8e7cc3', icon: '🔗' },
  contract: { color: '#8e7cc3', icon: '📜' },
  topic: { color: '#8e7cc3', icon: '🏷️' },
  note: { color: '#8a8f98', icon: '📝' },
}

/** Idiomatic look for a kind name (case-insensitive); neutral fallback if unknown. */
export function kindPreset(name: string): { color: string; icon: string } {
  return KIND_PRESETS[name.trim().toLowerCase()] ?? KIND_FALLBACK
}
