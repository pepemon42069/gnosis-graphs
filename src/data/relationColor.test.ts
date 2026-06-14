import { describe, expect, it } from 'vitest'
import { freshDb } from '../test/helpers'
import { dispatch } from './commands/dispatcher'
import { createRelationType } from './commands/relationTypeCommands'
import { setMeta } from './db'
import { relationColor } from './relationColor'
import { seedWorkspace } from './seed'

describe('relationColor', () => {
  it('is deterministic and case-insensitive', () => {
    expect(relationColor('Supports')).toBe(relationColor('supports'))
    expect(relationColor('supports')).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('relation types always carry a color', () => {
  it('derives a color from the name when none is given (picker/DSL path)', async () => {
    const db = await freshDb()
    const cmd = createRelationType('supports')
    await dispatch(cmd)
    expect((await db.relationTypes.get(cmd.relationTypeId))?.color).toBe(relationColor('supports'))
  })

  it('keeps an explicit color (settings add-row path)', async () => {
    const db = await freshDb()
    const cmd = createRelationType('refines', '#123456')
    await dispatch(cmd)
    expect((await db.relationTypes.get(cmd.relationTypeId))?.color).toBe('#123456')
  })

  it('backfills a color onto older color-less rows on re-seed', async () => {
    const db = await freshDb()
    await db.relationTypes.add({ id: 'rt-legacy', name: 'legacy', createdAt: 0, updatedAt: 0 })
    await setMeta(db, 'seedVersion', 2)
    await seedWorkspace(db)
    expect((await db.relationTypes.get('rt-legacy'))?.color).toBe(relationColor('legacy'))
  })
})
