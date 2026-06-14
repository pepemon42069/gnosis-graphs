/** Kebab-case text for a filename; falls back to `fallback` when nothing remains. */
export function slug(text: string, fallback = 'node'): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || fallback
}
