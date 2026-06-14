import { beforeEach, describe, expect, it } from 'vitest'
import { dumpAll, freshDb } from '../../test/helpers'
import { assertIntegrity } from '../../test/integrity'
import { canUndo, dispatch } from '../commands/dispatcher'
import { createEdge } from '../commands/edgeCommands'
import { createNode, createSubGraph } from '../commands/nodeCommands'
import { getMeta, type GnosisDB } from '../db'
import type { WorkspaceBundle } from '../types'
import { exportBundle } from './exportBundle'
import { importBundle, InvalidBundleError, readBundleFile } from './importBundle'
import { BundleTooNewError, migrateBundle } from './migrate'

let db: GnosisDB

beforeEach(async () => {
  db = await freshDb()
})

/** Root graph: alpha (with sub-graph), beta; edge alpha -> beta. Returns beta's id. */
async function buildWorkspace(): Promise<string> {
  const rootGraphId = (await getMeta<string>(db, 'rootGraphId'))!
  const makeAlpha = createNode({ title: 'alpha', placement: { graphId: rootGraphId, x: 0, y: 0 } })
  const makeBeta = createNode({ title: 'beta', placement: { graphId: rootGraphId, x: 200, y: 0 } })
  await dispatch(makeAlpha)
  await dispatch(makeBeta)
  const relatesTo = (await db.relationTypes.filter((t) => t.name === 'relates to').first())!.id
  await dispatch(
    createEdge({
      graphId: rootGraphId,
      fromNodeId: makeAlpha.nodeId,
      toNodeId: makeBeta.nodeId,
      relationTypeId: relatesTo,
    }),
  )
  await dispatch(createSubGraph(makeAlpha.nodeId, 'alpha internals'))
  return makeBeta.nodeId
}

describe('workspace bundle (§9)', () => {
  it('round-trips: import restores the exact dump taken at export, meta included', async () => {
    const betaId = await buildWorkspace()
    const bundle = await exportBundle()
    const atExport = await dumpAll(db)

    await db.nodes.delete(betaId)
    expect(await dumpAll(db)).not.toEqual(atExport)

    await importBundle(bundle)
    expect(await dumpAll(db)).toEqual(atExport)
    await assertIntegrity(db)
  })

  it('refuses a newer bundle and leaves the workspace untouched', async () => {
    await buildWorkspace()
    const bundle = await exportBundle()
    const before = await dumpAll(db)
    const newer: WorkspaceBundle = { ...bundle, schemaVersion: bundle.schemaVersion + 1 }

    await expect(importBundle(newer)).rejects.toBeInstanceOf(BundleTooNewError)
    expect(await dumpAll(db)).toEqual(before)
  })

  it('rejects malformed bundles with InvalidBundleError', async () => {
    await expect(importBundle({})).rejects.toBeInstanceOf(InvalidBundleError)
    const bundle = await exportBundle()
    await expect(importBundle({ ...bundle, nodes: 'nope' })).rejects.toBeInstanceOf(
      InvalidBundleError,
    )
  })

  it('refuses bundles that would brick boot or dangle references, untouched', async () => {
    await buildWorkspace()
    const bundle = await exportBundle()
    const before = await dumpAll(db)

    const empty: WorkspaceBundle = { ...bundle, graphs: [] }
    await expect(importBundle(empty)).rejects.toBeInstanceOf(InvalidBundleError)

    const danglingEdge: WorkspaceBundle = {
      ...bundle,
      edges: bundle.edges.map((e) => ({ ...e, toNodeId: 'missing' })),
    }
    await expect(importBundle(danglingEdge)).rejects.toBeInstanceOf(InvalidBundleError)

    const danglingChild: WorkspaceBundle = {
      ...bundle,
      nodes: bundle.nodes.map((n) => (n.childGraphId ? { ...n, childGraphId: 'missing' } : n)),
    }
    await expect(importBundle(danglingChild)).rejects.toBeInstanceOf(InvalidBundleError)

    const danglingMeta: WorkspaceBundle = {
      ...bundle,
      meta: { ...bundle.meta, rootGraphId: 'missing' },
    }
    await expect(importBundle(danglingMeta)).rejects.toBeInstanceOf(InvalidBundleError)

    expect(await dumpAll(db)).toEqual(before)
  })

  it('importing a pre-Home bundle (v0.1 export) heals Home immediately (§2)', async () => {
    await buildWorkspace()
    const bundle = await exportBundle()
    // Reconstruct a v0.1-shaped bundle: no Home graph, no pointer node, null meta.
    const homeId = bundle.meta.homeGraphId!
    const onHome = new Set(
      bundle.placements.filter((p) => p.graphId === homeId).map((p) => p.nodeId),
    )
    const preHome: WorkspaceBundle = {
      ...bundle,
      graphs: bundle.graphs.filter((g) => g.id !== homeId),
      placements: bundle.placements.filter((p) => p.graphId !== homeId),
      nodes: bundle.nodes.filter((n) => !onHome.has(n.id)),
      edges: bundle.edges.filter((e) => e.graphId !== homeId),
      meta: { rootGraphId: bundle.meta.rootGraphId, homeGraphId: null },
    }

    await importBundle(preHome)
    const healedHomeId = await getMeta<string>(db, 'homeGraphId')
    expect(healedHomeId).toBeDefined()
    expect(await db.graphs.get(healedHomeId!)).toBeDefined()
    // The healed Home points at the imported root again.
    const pointer = await db.nodes.where('childGraphId').equals(preHome.meta.rootGraphId!).first()
    expect(pointer).toBeDefined()
    await assertIntegrity(db)
  })

  it("migrates a v1 bundle on import: 'json' payloads become a code/json file", async () => {
    await buildWorkspace()
    const bundle = await exportBundle()
    const target = bundle.nodes.find((n) => n.title === 'alpha')!
    // A true v1 bundle predates the files table: inline payloads, no files array.
    const v1 = {
      ...bundle,
      files: undefined,
      schemaVersion: 1,
      nodes: bundle.nodes.map((n) =>
        n.id === target.id
          ? { ...n, payload: { format: 'json', content: '{"a": 1}' } }
          : { ...n, payload: undefined },
      ),
    }

    await importBundle(v1)
    const node = (await db.nodes.get(target.id))!
    expect(node.payload?.kind).toBe('file')
    const file = (await db.files.where('nodeId').equals(target.id).first())!
    expect(file).toMatchObject({ format: 'code', language: 'json', content: '{"a": 1}' })
    await assertIntegrity(db)
  })

  it('migrate to:3 maps inline payloads to file/link references', async () => {
    const node = (id: string, title: string, payload: unknown) => ({
      id,
      title,
      tags: [],
      payload,
      createdAt: 0,
      updatedAt: 0,
    })
    const v2: WorkspaceBundle = {
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      nodes: [
        node('n-md', 'My Notes', { format: 'markdown', content: '# Hi' }),
        node('n-code', 'Conf', { format: 'code', content: '{}', language: 'json' }),
        node('n-link', 'Site', { format: 'link', content: 'https://x.test' }),
        node('n-empty', 'Empty', { format: 'markdown', content: '' }),
      ] as unknown as WorkspaceBundle['nodes'],
      graphs: [{ id: 'g', name: 'G', createdAt: 0, updatedAt: 0 }],
      placements: [],
      edges: [],
      relationTypes: [],
      kinds: [],
      files: [],
      meta: { rootGraphId: 'g', homeGraphId: 'g' },
    }
    const v3 = migrateBundle(v2)
    expect(v3.schemaVersion).toBe(3)

    const byId = new Map(v3.nodes.map((n) => [n.id, n]))
    expect(byId.get('n-link')!.payload).toEqual({ kind: 'link', url: 'https://x.test' })
    expect(byId.get('n-empty')!.payload).toBeUndefined()

    const mdFile = v3.files.find((f) => f.nodeId === 'n-md')!
    expect(byId.get('n-md')!.payload).toEqual({ kind: 'file', fileId: mdFile.id })
    expect(mdFile).toMatchObject({ filename: 'my-notes.md', format: 'markdown', content: '# Hi' })

    const codeFile = v3.files.find((f) => f.nodeId === 'n-code')!
    expect(codeFile).toMatchObject({ filename: 'conf.json', format: 'code', language: 'json' })
    expect(v3.files.find((f) => f.nodeId === 'n-link')).toBeUndefined()
    expect(v3.files.find((f) => f.nodeId === 'n-empty')).toBeUndefined()
  })

  it('the folder-mirror handle survives a workspace replace (§8)', async () => {
    await db.meta.put({ key: 'mirrorDirHandle', value: { fake: 'handle' } })
    const bundle = await exportBundle()
    await importBundle(bundle)
    expect((await db.meta.get('mirrorDirHandle'))?.value).toEqual({ fake: 'handle' })
  })

  it('readBundleFile parses valid JSON and rejects invalid JSON', async () => {
    const bundle = await exportBundle()
    const valid = new File([JSON.stringify(bundle)], 'bundle.json')
    expect(await readBundleFile(valid)).toEqual(bundle)

    const broken = new File(['{not json'], 'broken.json')
    await expect(readBundleFile(broken)).rejects.toBeInstanceOf(InvalidBundleError)
  })

  it('import clears the undo history', async () => {
    await buildWorkspace()
    const bundle = await exportBundle()
    expect(canUndo()).toBe(true)

    await importBundle(bundle)
    expect(canUndo()).toBe(false)
  })
})
