import { fetchExport } from '../client'
import type { WorkspaceBundle } from '../types'
import { downloadBlob, zipFiles } from './files'
import { graphToCanvas, slugFileName } from './jsonCanvas'

/**
 * Exports a graph plus every graph reachable through placed nodes' child
 * graphs, each emitted exactly once. Filenames are assigned on first visit, so
 * repeated references — containment cycles included — resolve to the
 * already-emitted file and the walk terminates (§9).
 */
export function exportGraphAsCanvas(
  bundle: WorkspaceBundle,
  graphId: string,
): { files: Map<string, string> } {
  return { files: walkGraphs(bundle, graphId) }
}

function walkGraphs(bundle: WorkspaceBundle, startGraphId: string): Map<string, string> {
  const graphNames = new Map(bundle.graphs.map((g) => [g.id, g.name]))
  const nodesById = new Map(bundle.nodes.map((n) => [n.id, n]))
  const fileNames = new Map<string, string>()
  const fileNameFor = (graphId: string): string => {
    let name = fileNames.get(graphId)
    if (!name) {
      name = slugFileName(graphNames.get(graphId) ?? '', graphId)
      fileNames.set(graphId, name)
    }
    return name
  }

  const files = new Map<string, string>()
  const visited = new Set([startGraphId])
  const queue = [startGraphId]
  for (let graphId = queue.shift(); graphId !== undefined; graphId = queue.shift()) {
    files.set(fileNameFor(graphId), graphToCanvas(bundle, graphId, fileNameFor))
    for (const placement of bundle.placements) {
      if (placement.graphId !== graphId) continue
      const childGraphId = nodesById.get(placement.nodeId)?.childGraphId
      if (childGraphId && !visited.has(childGraphId)) {
        visited.add(childGraphId)
        queue.push(childGraphId)
      }
    }
  }
  return files
}

export async function downloadCanvasExport(graphId: string): Promise<void> {
  const { files } = exportGraphAsCanvas(await fetchExport(), graphId)
  const [first] = files
  if (!first) return
  const [rootFileName, rootText] = first
  if (files.size === 1) {
    downloadBlob(rootFileName, new Blob([rootText], { type: 'application/json' }))
    return
  }
  const slug = rootFileName.replace(/-[0-9a-f]{8}\.canvas$/, '')
  downloadBlob(`${slug}-canvas.zip`, zipFiles(files))
}
