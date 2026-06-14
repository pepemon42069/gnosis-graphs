import { beforeEach, describe, expect, it } from 'vitest'
import { freshDb } from '../../test/helpers'
import { exportBundle } from '../bundle/exportBundle'
import { dispatch } from '../commands/dispatcher'
import { createEdge } from '../commands/edgeCommands'
import { createGraph } from '../commands/graphCommands'
import { createNode, createSubGraph, linkChildGraph } from '../commands/nodeCommands'
import type { GnosisDB } from '../db'
import { exportGraphAsCanvas } from './canvasExport'
import { CANVAS_NODE_HEIGHT, CANVAS_NODE_WIDTH, slugFileName } from './jsonCanvas'
import { markdownFiles } from './markdownExport'

let db: GnosisDB

beforeEach(async () => {
  db = await freshDb()
})

interface ParsedCanvas {
  nodes: {
    id: string
    x: number
    y: number
    width: number
    height: number
    type: string
    text?: string
    url?: string
    file?: string
  }[]
  edges: { id: string; fromNode: string; toNode: string; toEnd: string; label: string }[]
}

function parseCanvas(text: string | undefined): ParsedCanvas {
  if (text === undefined) throw new Error('Expected canvas text')
  return JSON.parse(text) as ParsedCanvas
}

describe('JSON Canvas export (§9)', () => {
  it('terminates on an A↔B containment cycle, emitting each graph exactly once', async () => {
    const makeAlpha = createGraph('Alpha')
    await dispatch(makeAlpha)
    const toBeta = createNode({
      title: 'to beta',
      placement: { graphId: makeAlpha.graphId, x: 0, y: 0 },
    })
    await dispatch(toBeta)
    const makeBeta = createSubGraph(toBeta.nodeId, 'Beta')
    await dispatch(makeBeta)
    const backToAlpha = createNode({
      title: 'back to alpha',
      placement: { graphId: makeBeta.graphId, x: 5, y: 6 },
    })
    await dispatch(backToAlpha)
    await dispatch(linkChildGraph(backToAlpha.nodeId, makeAlpha.graphId))

    const { files } = exportGraphAsCanvas(await exportBundle(), makeAlpha.graphId)
    const alphaFile = slugFileName('Alpha', makeAlpha.graphId)
    const betaFile = slugFileName('Beta', makeBeta.graphId)
    expect([...files.keys()]).toEqual([alphaFile, betaFile])

    const beta = parseCanvas(files.get(betaFile))
    expect(beta.nodes).toEqual([
      {
        id: backToAlpha.nodeId,
        x: 5,
        y: 6,
        width: CANVAS_NODE_WIDTH,
        height: CANVAS_NODE_HEIGHT,
        type: 'file',
        file: alphaFile,
      },
    ])
  })

  it('exports a payload-less child-graph node as a file node', async () => {
    const makeGraph = createGraph('Outer')
    await dispatch(makeGraph)
    const node = createNode({
      title: 'opens inner',
      placement: { graphId: makeGraph.graphId, x: 10, y: 20 },
    })
    await dispatch(node)
    const makeInner = createSubGraph(node.nodeId, 'Inner')
    await dispatch(makeInner)

    const { files } = exportGraphAsCanvas(await exportBundle(), makeGraph.graphId)
    expect(files.size).toBe(2)
    const outer = parseCanvas(files.get(slugFileName('Outer', makeGraph.graphId)))
    expect(outer.nodes).toEqual([
      {
        id: node.nodeId,
        x: 10,
        y: 20,
        width: CANVAS_NODE_WIDTH,
        height: CANVAS_NODE_HEIGHT,
        type: 'file',
        file: slugFileName('Inner', makeInner.graphId),
      },
    ])
  })

  it('keeps a payload+child-graph node as text with a sibling link appended', async () => {
    const makeGraph = createGraph('Dual')
    await dispatch(makeGraph)
    const node = createNode({
      title: 'Note',
      file: { filename: 'note.md', format: 'markdown', content: 'Body text' },
      placement: { graphId: makeGraph.graphId, x: 1, y: 2 },
    })
    await dispatch(node)
    const makeSub = createSubGraph(node.nodeId, 'Sub Graph')
    await dispatch(makeSub)

    const { files } = exportGraphAsCanvas(await exportBundle(), makeGraph.graphId)
    expect(files.size).toBe(2)
    const subFile = slugFileName('Sub Graph', makeSub.graphId)
    const doc = parseCanvas(files.get(slugFileName('Dual', makeGraph.graphId)))
    expect(doc.nodes).toEqual([
      {
        id: node.nodeId,
        x: 1,
        y: 2,
        width: CANVAS_NODE_WIDTH,
        height: CANVAS_NODE_HEIGHT,
        type: 'text',
        text: `# Note\n\nBody text\n\n[Sub Graph](${subFile})`,
      },
    ])
  })

  it('fences code payloads with their language, maps link payloads to link nodes, and labels edges', async () => {
    const makeGraph = createGraph('Mix')
    await dispatch(makeGraph)
    const jsonNode = createNode({
      title: 'Config',
      file: { filename: 'config.json', format: 'code', language: 'json', content: '{"a": 1}' },
      placement: { graphId: makeGraph.graphId, x: 0, y: 0 },
    })
    const linkNode = createNode({
      title: 'Site',
      link: 'https://example.com',
      placement: { graphId: makeGraph.graphId, x: 300, y: 0 },
    })
    await dispatch(jsonNode)
    await dispatch(linkNode)
    const cites = (await db.relationTypes.filter((t) => t.name === 'cites').first())!
    const edge = createEdge({
      graphId: makeGraph.graphId,
      fromNodeId: jsonNode.nodeId,
      toNodeId: linkNode.nodeId,
      relationTypeId: cites.id,
    })
    await dispatch(edge)

    const { files } = exportGraphAsCanvas(await exportBundle(), makeGraph.graphId)
    expect(files.size).toBe(1)
    const doc = parseCanvas(files.get(slugFileName('Mix', makeGraph.graphId)))
    const byId = new Map(doc.nodes.map((n) => [n.id, n]))
    expect(byId.get(jsonNode.nodeId)).toMatchObject({
      type: 'text',
      text: '# Config\n\n```json\n{"a": 1}\n```',
    })
    expect(byId.get(linkNode.nodeId)).toMatchObject({ type: 'link', url: 'https://example.com' })
    expect(doc.edges).toEqual([
      {
        id: edge.edgeId,
        fromNode: jsonNode.nodeId,
        toNode: linkNode.nodeId,
        toEnd: 'arrow',
        label: 'cites',
      },
    ])
  })
})

describe('markdown export (§9)', () => {
  it('writes exact frontmatter, omitting kind and tags when absent', async () => {
    const concept = (await db.kinds.filter((k) => k.name === 'concept').first())!
    const tagged = createNode({
      title: 'Say "hi"',
      file: { filename: 'hi.md', format: 'markdown', content: '# Hello' },
      kindId: concept.id,
      tags: ['a', 'b'],
    })
    const bare = createNode({
      title: 'Plain',
      file: { filename: 'plain.md', format: 'markdown', content: 'body' },
    })
    await dispatch(tagged)
    await dispatch(bare)

    const files = markdownFiles(await exportBundle())
    expect(files.get(`say-hi-${tagged.nodeId.slice(0, 8)}.md`)).toBe(
      `---\nid: ${tagged.nodeId}\ntitle: "Say \\"hi\\""\nkind: concept\ntags: [a, b]\n---\n\n# Hello`,
    )
    expect(files.get(`plain-${bare.nodeId.slice(0, 8)}.md`)).toBe(
      `---\nid: ${bare.nodeId}\ntitle: "Plain"\n---\n\nbody`,
    )
  })

  it('includes only markdown files', async () => {
    const markdown = createNode({
      title: 'Keep',
      file: { filename: 'keep.md', format: 'markdown', content: 'x' },
    })
    const plaintext = createNode({
      title: 'Drop',
      file: { filename: 'drop.txt', format: 'plaintext', content: 'x' },
    })
    const json = createNode({
      title: 'Skip',
      file: { filename: 'skip.json', format: 'code', language: 'json', content: '{}' },
    })
    await dispatch(markdown)
    await dispatch(plaintext)
    await dispatch(json)

    const bundle = await exportBundle()
    const files = markdownFiles(bundle)
    expect(files.has(`keep-${markdown.nodeId.slice(0, 8)}.md`)).toBe(true)
    expect(files.has(`drop-${plaintext.nodeId.slice(0, 8)}.md`)).toBe(false)
    expect(files.has(`skip-${json.nodeId.slice(0, 8)}.md`)).toBe(false)
    expect(files.size).toBe(bundle.files.filter((f) => f.format === 'markdown').length)
  })
})
