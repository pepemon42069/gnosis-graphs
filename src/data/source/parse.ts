/**
 * The per-graph authoring DSL parser. Pure and deterministic — no DB, no
 * @codemirror/language-data. Turns source text into a structural ParsedGraph
 * (or line-numbered errors); plan.ts resolves it against a real graph.
 */

export interface ParsedNode {
  /** The #token anchor, sans '#'. Absent ⇒ a brand-new node with no alias. */
  token?: string
  title: string
  kind?: string
  tags: string[]
  summary?: string
  file?: string
  link?: string
  /** 1-based header line, for diagnostics. */
  line: number
}

interface ParsedEdge {
  from: string
  to: string
  relation: string
  line: number
}

export interface ParsedGraph {
  nodes: ParsedNode[]
  edges: ParsedEdge[]
}

interface ParseError {
  line: number
  message: string
}

type Parsed = { graph: ParsedGraph } | { errors: ParseError[] }

const KEYS = new Set(['kind', 'tags', 'summary', 'file', 'link'])
const TOKEN = /^#(\S+)\s*(.*)$/
const EDGE = /^#?(\S+)\s*->\s*#?(\S+)\s*:(.*)$/

function indentOf(line: string): number {
  const match = /^[ \t]*/.exec(line)
  return match ? match[0].length : 0
}

export function parseGraphSource(text: string): Parsed {
  const lines = text.split('\n')
  const errors: ParseError[] = []
  const nodes: ParsedNode[] = []
  const edges: ParsedEdge[] = []
  const anchors = new Set<string>()
  let current: ParsedNode | null = null

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? ''
    const lineNo = i + 1
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('//')) continue

    const indented = indentOf(raw) > 0

    // An indented "key: value" belongs to the open node block.
    if (indented && current && isKeyLine(trimmed)) {
      applyKey(current, trimmed, lineNo, errors)
      continue
    }

    // Column-0 (or otherwise non-key) lines start a new block. An edge is any
    // header containing '->'; everything else is a node header.
    current = null
    if (trimmed.includes('->')) {
      const edge = parseEdge(trimmed, lineNo, errors)
      if (edge) edges.push(edge)
      continue
    }

    const node = parseHeader(trimmed, lineNo)
    if (node.token) {
      if (anchors.has(node.token)) {
        errors.push({ line: lineNo, message: `line ${lineNo}: duplicate anchor #${node.token}` })
      }
      anchors.add(node.token)
    }
    nodes.push(node)
    current = node
  }

  for (const node of nodes) {
    if (node.file !== undefined && node.link !== undefined) {
      errors.push({ line: node.line, message: `line ${node.line}: node has both file and link` })
    }
    if (!node.title) {
      errors.push({ line: node.line, message: `line ${node.line}: node has no title` })
    }
  }

  return errors.length ? { errors } : { graph: { nodes, edges } }
}

function isKeyLine(trimmed: string): boolean {
  const colon = trimmed.indexOf(':')
  if (colon < 0) return false
  return KEYS.has(trimmed.slice(0, colon).trim().toLowerCase())
}

function parseHeader(trimmed: string, line: number): ParsedNode {
  const node: ParsedNode = { title: trimmed, tags: [], line }
  const match = TOKEN.exec(trimmed)
  if (match) {
    node.token = match[1]
    node.title = (match[2] ?? '').trim()
  }
  return node
}

function applyKey(node: ParsedNode, trimmed: string, line: number, errors: ParseError[]): void {
  const colon = trimmed.indexOf(':')
  const key = trimmed.slice(0, colon).trim().toLowerCase()
  const value = trimmed.slice(colon + 1).trim()
  switch (key) {
    case 'kind':
      node.kind = value || undefined
      break
    case 'tags':
      node.tags = value
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      break
    case 'summary':
      node.summary = value || undefined
      break
    case 'file':
      if (!value) errors.push({ line, message: `line ${line}: file key has no filename` })
      node.file = value
      break
    case 'link':
      if (!value) errors.push({ line, message: `line ${line}: link key has no url` })
      node.link = value
      break
  }
}

function parseEdge(trimmed: string, line: number, errors: ParseError[]): ParsedEdge | null {
  const match = EDGE.exec(trimmed)
  if (!match) {
    errors.push({ line, message: `line ${line}: malformed edge (expected "#from -> #to : relation")` })
    return null
  }
  const from = match[1] ?? ''
  const to = match[2] ?? ''
  const rel = (match[3] ?? '').trim()
  if (!rel) {
    errors.push({ line, message: `line ${line}: edge has no relation` })
    return null
  }
  return { from, to, relation: rel, line }
}
