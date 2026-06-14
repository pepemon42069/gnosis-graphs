import type { Command } from '../commands/types'
import type { FileRecord, NodeRecord, PlacementRecord } from '../types'

const GRID_X = 340
const GRID_Y = 190

export interface MarkdownFile {
  name: string
  text: string
}

/** `---\n` opener at byte 0, body captured, `---` closer on its own line. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

function unquote(value: string): string {
  const trimmed = value.trim()
  const quoted = /^(['"])(.*)\1$/.exec(trimmed)
  return quoted?.[2] ?? trimmed
}

function parseFrontmatter(block: string): { title: string; tags: string[] } {
  const lines = block.split(/\r?\n/)
  let title = ''
  let tags: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const titleMatch = /^title:(.*)$/.exec(line)
    if (titleMatch) {
      title = unquote(titleMatch[1] ?? '')
      continue
    }
    const tagsMatch = /^tags:(.*)$/.exec(line)
    if (!tagsMatch) continue
    const rest = (tagsMatch[1] ?? '').trim()
    const inline = /^\[(.*)\]$/.exec(rest)
    if (inline) {
      tags = (inline[1] ?? '')
        .split(',')
        .map(unquote)
        .filter((tag) => tag !== '')
      continue
    }
    if (rest !== '') continue
    // Dash list: consume `- item` lines until the first non-item line.
    tags = []
    while (i + 1 < lines.length) {
      const item = /^\s*-\s+(.*)$/.exec(lines[i + 1] ?? '')
      if (!item) break
      const tag = unquote(item[1] ?? '')
      if (tag !== '') tags.push(tag)
      i++
    }
  }
  return { title, tags }
}

/**
 * Regex-only frontmatter for `title` and `tags` (no YAML dependency, §7).
 * Malformed or absent frontmatter → the entire text is content.
 */
export function parseMarkdownFile(file: MarkdownFile): {
  title: string
  tags: string[]
  content: string
} {
  const match = FRONTMATTER.exec(file.text)
  const fm = match ? parseFrontmatter(match[1] ?? '') : { title: '', tags: [] }
  const content = match ? file.text.slice(match[0].length).replace(/^\r?\n/, '') : file.text
  const heading = /^#[ \t]+(.+)$/m.exec(content)?.[1]?.trim()
  const title = fm.title || heading || file.name.replace(/\.[^.]+$/, '').trim()
  return { title, tags: fm.tags, content }
}

export interface ImportMarkdownCommand extends Command {
  graphId: string
}

/**
 * One undoable command for the whole import (§7 bulk import): a new graph,
 * one markdown node per file, grid placements on ceil(sqrt(N)) columns.
 */
export function importMarkdownFolder(
  graphName: string,
  files: MarkdownFile[],
): ImportMarkdownCommand {
  const graphId = crypto.randomUUID()
  const now = Date.now()
  const columns = Math.ceil(Math.sqrt(files.length))
  const nodes: NodeRecord[] = []
  const fileRecords: FileRecord[] = []
  const placements: PlacementRecord[] = []
  files.forEach((file, index) => {
    const parsed = parseMarkdownFile(file)
    const nodeId = crypto.randomUUID()
    const fileId = crypto.randomUUID()
    nodes.push({
      id: nodeId,
      title: parsed.title || file.name,
      tags: parsed.tags,
      payload: { kind: 'file', fileId },
      createdAt: now,
      updatedAt: now,
    })
    fileRecords.push({
      id: fileId,
      nodeId,
      filename: file.name,
      format: 'markdown',
      content: parsed.content,
      createdAt: now,
      updatedAt: now,
    })
    placements.push({
      id: crypto.randomUUID(),
      graphId,
      nodeId,
      x: (index % columns) * GRID_X,
      y: Math.floor(index / columns) * GRID_Y,
      createdAt: now,
      updatedAt: now,
    })
  })
  const nodeIds = nodes.map((n) => n.id)
  const fileIds = fileRecords.map((f) => f.id)
  return {
    label: 'import-markdown-folder',
    // Pure creation, not a destructive cascade; the 5-min dirty timer pairs
    // the import with a snapshot — no forced snapshot here.
    cascade: false,
    graphId,
    async do(db) {
      await db.graphs.add({ id: graphId, name: graphName, createdAt: now, updatedAt: now })
      await db.nodes.bulkAdd(nodes)
      await db.files.bulkAdd(fileRecords)
      await db.placements.bulkAdd(placements)
      return [
        { type: 'graphs-changed', upserted: [graphId], removed: [] },
        { type: 'nodes-changed', upserted: nodeIds, removed: [] },
        { type: 'files-changed', fileIds },
        { type: 'placements-changed', graphIds: [graphId] },
      ]
    },
    async undo(db) {
      await db.placements.bulkDelete(placements.map((p) => p.id))
      await db.files.bulkDelete(fileIds)
      await db.nodes.bulkDelete(nodeIds)
      await db.graphs.delete(graphId)
      return [
        { type: 'graphs-changed', upserted: [], removed: [graphId] },
        { type: 'nodes-changed', upserted: [], removed: nodeIds },
        { type: 'files-changed', fileIds },
        { type: 'placements-changed', graphIds: [graphId] },
      ]
    },
  }
}
