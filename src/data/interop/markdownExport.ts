import { fetchExport } from '../client'
import { slug } from '../files/slug'
import type { WorkspaceBundle } from '../types'
import { downloadBlob, zipFiles } from './files'

/**
 * One `.md` file per markdown file, with YAML frontmatter (id, title, kind,
 * tags) — Obsidian-vault compatible (§9). Other formats and links are skipped.
 */
export function markdownFiles(bundle: WorkspaceBundle): Map<string, string> {
  const kindNames = new Map(bundle.kinds.map((k) => [k.id, k.name]))
  const nodesById = new Map(bundle.nodes.map((n) => [n.id, n]))
  const files = new Map<string, string>()
  for (const file of bundle.files) {
    if (file.format !== 'markdown') continue
    const node = nodesById.get(file.nodeId)
    if (!node) continue
    const lines = ['---', `id: ${node.id}`, `title: "${node.title.replaceAll('"', '\\"')}"`]
    const kind = node.kindId ? kindNames.get(node.kindId) : undefined
    if (kind) lines.push(`kind: ${kind}`)
    if (node.tags.length > 0) lines.push(`tags: [${node.tags.join(', ')}]`)
    lines.push('---', '', file.content)
    files.set(`${slug(node.title)}-${node.id.slice(0, 8)}.md`, lines.join('\n'))
  }
  return files
}

export async function downloadMarkdownExport(): Promise<void> {
  const files = markdownFiles(await fetchExport())
  if (files.size === 0) {
    window.alert('No markdown nodes to export')
    return
  }
  downloadBlob('gnosis-markdown.zip', zipFiles(files))
}
