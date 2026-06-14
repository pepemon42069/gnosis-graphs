import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// DIR is read from GNOSIS_FILES at module load, so set the env then re-import the
// whole module graph fresh so files-mirror and the db layer it reads share it.
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gnosis-files-'))
  process.env.GNOSIS_FILES = dir
  vi.resetModules()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.GNOSIS_FILES
})

describe('files-mirror reconcile', () => {
  it('tolerates a stray sub-directory under GNOSIS_FILES instead of aborting', async () => {
    const { dispatch } = await import('../src/data/commands/dispatcher')
    const { createNode } = await import('../src/data/commands/nodeCommands')
    const { getMeta } = await import('../src/data/db')
    const { freshDb } = await import('../src/test/helpers')
    const { reconcile } = await import('./files-mirror')

    const db = await freshDb()
    const graphId = (await getMeta<string>(db, 'rootGraphId'))!
    await dispatch(
      createNode({
        title: 'Doc',
        file: { filename: 'doc.md', format: 'markdown', content: 'hello' },
        placement: { graphId, x: 0, y: 0 },
      }),
    )

    // A stray directory the DB does not know about — the old prune (rmSync without
    // { recursive: true }) threw EISDIR here and wedged the whole reconcile.
    mkdirSync(join(dir, 'stray-dir'))
    writeFileSync(join(dir, 'stray-dir', 'inner.txt'), 'x')

    await expect(reconcile()).resolves.toBeUndefined()

    // The DB file is mirrored; the stray dir (not in the DB) is pruned away.
    const onDisk = readdirSync(dir)
    expect(onDisk.some((f) => f.startsWith('doc-') && f.endsWith('.md'))).toBe(true)
    expect(existsSync(join(dir, 'stray-dir'))).toBe(false)
  })
})
