import { describe, expect, it } from 'vitest'
import { type ParsedGraph, parseGraphSource } from './parse'

function graph(text: string): ParsedGraph {
  const result = parseGraphSource(text)
  if ('errors' in result) throw new Error(`unexpected errors: ${JSON.stringify(result.errors)}`)
  return result.graph
}

function errors(text: string) {
  const result = parseGraphSource(text)
  if ('graph' in result) throw new Error('expected errors')
  return result.errors
}

describe('parseGraphSource happy path', () => {
  it('parses the canonical grammar', () => {
    const src = [
      '#a1b2c3d4 Transformers',
      '  kind: concept',
      '  tags: ml, attention',
      '  summary: The architecture behind modern LLMs.',
      '  file: transformers.md',
      '',
      '#d4e5f6a7 Attention Is All You Need',
      '  kind: paper',
      '  link: https://arxiv.org/abs/1706.03762',
      '',
      'New idea',
      '  kind: question',
      '  file: new-idea.md',
      '',
      '#a1b2c3d4 -> #d4e5f6a7 : cites',
    ].join('\n')
    const g = graph(src)
    expect(g.nodes).toHaveLength(3)
    expect(g.nodes[0]).toMatchObject({
      token: 'a1b2c3d4',
      title: 'Transformers',
      kind: 'concept',
      tags: ['ml', 'attention'],
      summary: 'The architecture behind modern LLMs.',
      file: 'transformers.md',
    })
    expect(g.nodes[1]).toMatchObject({ token: 'd4e5f6a7', link: 'https://arxiv.org/abs/1706.03762' })
    expect(g.nodes[2]).toMatchObject({ title: 'New idea', file: 'new-idea.md' })
    expect(g.nodes[2]?.token).toBeUndefined()
    expect(g.edges).toEqual([
      { from: 'a1b2c3d4', to: 'd4e5f6a7', relation: 'cites', line: 15 },
    ])
  })

  it('ignores blank lines and // comments', () => {
    const g = graph(['// a comment', '', '#abc Title', '  // opens: Sub', '  kind: concept'].join('\n'))
    expect(g.nodes).toHaveLength(1)
    expect(g.nodes[0]).toMatchObject({ token: 'abc', title: 'Title', kind: 'concept' })
  })

  it('treats a node with no keys as a pure graph-pointer node', () => {
    const g = graph('Just a title')
    expect(g.nodes[0]).toMatchObject({ title: 'Just a title' })
    expect(g.nodes[0]?.file).toBeUndefined()
    expect(g.nodes[0]?.link).toBeUndefined()
  })

  it('accepts edge endpoints without the leading #', () => {
    const g = graph(['#a One', '#b Two', 'a -> b : relates to'].join('\n'))
    expect(g.edges[0]).toMatchObject({ from: 'a', to: 'b', relation: 'relates to' })
  })
})

describe('parseGraphSource errors', () => {
  it('reports both file and link on one node with the header line', () => {
    const errs = errors(['#a Title', '  file: a.md', '  link: https://x.test'].join('\n'))
    expect(errs).toEqual([{ line: 1, message: 'line 1: node has both file and link' }])
  })

  it('reports a duplicate anchor', () => {
    const errs = errors(['#abc One', '', '#abc Two'].join('\n'))
    expect(errs).toContainEqual({ line: 3, message: 'line 3: duplicate anchor #abc' })
  })

  it('reports a node with no title', () => {
    const errs = errors('#abc')
    expect(errs).toContainEqual({ line: 1, message: 'line 1: node has no title' })
  })

  it('reports a malformed edge (missing relation)', () => {
    const errs = errors('#a -> #b')
    expect(errs[0]?.message).toMatch(/malformed edge/)
  })

  it('reports an edge with an empty relation', () => {
    const errs = errors('#a -> #b :   ')
    expect(errs[0]?.message).toMatch(/no relation/)
  })

  it('reports a file key with no filename', () => {
    const errs = errors(['#a Title', '  file:'].join('\n'))
    expect(errs).toContainEqual({ line: 2, message: 'line 2: file key has no filename' })
  })

  it('reports a link key with no url', () => {
    const errs = errors(['#a Title', '  link:'].join('\n'))
    expect(errs).toContainEqual({ line: 2, message: 'line 2: link key has no url' })
  })
})
