import { beforeEach, describe, expect, it } from 'vitest'
import { dumpAll, freshDb, type WorkspaceDump } from '../../test/helpers'
import { assertIntegrity } from '../../test/integrity'
import { dispatch, redo, undo } from '../commands/dispatcher'
import type { GnosisDB } from '../db'
import { importMarkdownFolder, type MarkdownFile, parseMarkdownFile } from './markdownImport'

describe('parseMarkdownFile', () => {
  it('reads frontmatter title and inline-array tags, strips the block', () => {
    const parsed = parseMarkdownFile({
      name: 'alpha.md',
      text: '---\ntitle: Alpha Note\ntags: [graph, notes]\n---\n\nBody text.\n',
    })
    expect(parsed).toEqual({
      title: 'Alpha Note',
      tags: ['graph', 'notes'],
      content: 'Body text.\n',
    })
  })

  it('reads a quoted title and dash-list tags', () => {
    const parsed = parseMarkdownFile({
      name: 'beta.md',
      text: '---\ntitle: "Quoted: Title"\ntags:\n  - alpha\n  - beta\n---\nBody.\n',
    })
    expect(parsed).toEqual({ title: 'Quoted: Title', tags: ['alpha', 'beta'], content: 'Body.\n' })
  })

  it('without frontmatter keeps the body intact and falls back to the first # heading', () => {
    const text = '# My Heading\n\nSome text.\n'
    const parsed = parseMarkdownFile({ name: 'gamma.md', text })
    expect(parsed).toEqual({ title: 'My Heading', tags: [], content: text })
  })

  it('keeps malformed frontmatter (no closing fence) in the content', () => {
    const text = '---\ntitle: Broken\nno closing fence\n'
    const parsed = parseMarkdownFile({ name: 'broken.md', text })
    expect(parsed).toEqual({ title: 'broken', tags: [], content: text })
  })

  it('falls back to the file name without extension when nothing else yields a title', () => {
    const parsed = parseMarkdownFile({ name: 'meeting-notes.md', text: 'just text\n' })
    expect(parsed.title).toBe('meeting-notes')
  })
})

describe('importMarkdownFolder', () => {
  const files: MarkdownFile[] = [
    { name: 'one.md', text: '---\ntitle: one\ntags: [a, b]\n---\nfirst body\n' },
    { name: 'two.md', text: 'second body\n' },
    { name: 'three.md', text: '# three\n\nthird body\n' },
    { name: 'four.md', text: 'fourth body\n' },
    { name: 'five.md', text: 'fifth body\n' },
  ]

  let db: GnosisDB
  let before: WorkspaceDump

  beforeEach(async () => {
    db = await freshDb()
    before = await dumpAll(db)
  })

  async function placementOf(graphId: string, title: string) {
    const node = (await db.nodes.filter((n) => n.title === title).first())!
    return db.placements.get({ graphId, nodeId: node.id })
  }

  it('creates one graph, five markdown nodes, and a 3-column grid of placements', async () => {
    const command = importMarkdownFolder('Inbox', files)
    await dispatch(command)
    await assertIntegrity(db)

    expect((await db.graphs.get(command.graphId))?.name).toBe('Inbox')
    expect(await db.placements.where('graphId').equals(command.graphId).count()).toBe(5)

    const one = (await db.nodes.filter((n) => n.title === 'one').first())!
    expect(one.tags).toEqual(['a', 'b'])
    expect(one.payload?.kind).toBe('file')
    const oneFile = (await db.files.where('nodeId').equals(one.id).first())!
    expect(oneFile).toMatchObject({ filename: 'one.md', format: 'markdown', content: 'first body\n' })

    // ceil(sqrt(5)) = 3 columns at 340 x 190 spacing, origin 0,0.
    expect(await placementOf(command.graphId, 'one')).toMatchObject({ x: 0, y: 0 })
    expect(await placementOf(command.graphId, 'two')).toMatchObject({ x: 340, y: 0 })
    expect(await placementOf(command.graphId, 'three')).toMatchObject({ x: 680, y: 0 })
    expect(await placementOf(command.graphId, 'four')).toMatchObject({ x: 0, y: 190 })
  })

  it('one undo removes everything; redo restores with identical ids', async () => {
    await dispatch(importMarkdownFolder('Inbox', files))
    await assertIntegrity(db)
    const after = await dumpAll(db)

    await undo()
    await assertIntegrity(db)
    expect(await dumpAll(db)).toEqual(before)

    await redo()
    await assertIntegrity(db)
    expect(await dumpAll(db)).toEqual(after)
  })
})
