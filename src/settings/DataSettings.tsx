import { useRef } from 'react'
import { useSessionStore } from '../app/store'
import { downloadBundle } from '../data/bundle/downloadBundle'
import { readBundleFile } from '../data/bundle/importBundle'
import { fetchExport, fetchMeta, importBundle, refreshVocab, resetWorkspace } from '../data/client'
import { downloadMarkdownExport } from '../data/interop/markdownExport'
import { visit } from '../nav/history'
import { ImportFolderButton } from './ImportFolderButton'

function reportError(error: unknown): void {
  window.alert(error instanceof Error ? error.message : String(error))
}

/** After a replace/reset the Home graph id changes — resync meta, vocab, and nav. */
async function afterWorkspaceReplaced(): Promise<void> {
  await refreshVocab()
  const meta = await fetchMeta()
  useSessionStore.getState().setHomeGraphId(meta.homeGraphId)
  useSessionStore.getState().setSettingsOpen(false)
  if (meta.initialGraphId) visit(meta.initialGraphId, [meta.initialGraphId], 'replace')
}

/** Workspace bundle exit/entry (§9) — the import confirm opens above the modal (z-order). */
export function DataSettings() {
  const fileInput = useRef<HTMLInputElement>(null)

  const exportWorkspace = () => {
    fetchExport().then(downloadBundle).catch(reportError)
  }

  const onImportFile = (file: File) => {
    readBundleFile(file)
      .then((raw) => {
        useSessionStore.getState().requestConfirm({
          message: `Replace the entire workspace with "${file.name}"? Everything currently here will be overwritten.`,
          confirmLabel: 'Replace workspace',
          isDanger: true,
          onConfirm: () => {
            importBundle(raw).then(afterWorkspaceReplaced).catch(reportError)
          },
        })
      })
      .catch(reportError)
  }

  const onReset = () => {
    useSessionStore.getState().requestConfirm({
      message: 'Wipe everything and start fresh? A snapshot is written first.',
      confirmLabel: 'Reset workspace',
      isDanger: true,
      onConfirm: () => {
        resetWorkspace().then(afterWorkspaceReplaced).catch(reportError)
      },
    })
  }

  return (
    <>
      <section className="settings-group">
        <h3 className="ui-section-label pixel-label">Export</h3>
        <div className="settings-action">
          <div className="settings-action-text">
            <strong>Workspace bundle</strong>
            <span>One JSON file with this project’s graphs, nodes, edges, and vocabulary.</span>
          </div>
          <button
            type="button"
            className="ui-button"
            aria-label="Export workspace bundle"
            onClick={exportWorkspace}
          >
            Export
          </button>
        </div>
        <div className="settings-action">
          <div className="settings-action-text">
            <strong>Markdown notes</strong>
            <span>Every node’s text as .md files in a zip, foldered by graph.</span>
          </div>
          <button
            type="button"
            className="ui-button"
            aria-label="Export markdown notes"
            onClick={() => downloadMarkdownExport().catch(reportError)}
          >
            Export
          </button>
        </div>
      </section>
      <section className="settings-group">
        <h3 className="ui-section-label pixel-label">Import</h3>
        <div className="settings-action">
          <div className="settings-action-text">
            <strong>Workspace bundle</strong>
            <span>Replaces everything in this project — a snapshot is taken first.</span>
          </div>
          <button
            type="button"
            className="ui-button"
            aria-label="Import workspace bundle"
            onClick={() => fileInput.current?.click()}
          >
            Import…
          </button>
        </div>
        <div className="settings-action">
          <div className="settings-action-text">
            <strong>Markdown folder</strong>
            <span>Turns a folder of .md files into a new graph, one node per file.</span>
          </div>
          <ImportFolderButton />
        </div>
      </section>
      <section className="settings-group">
        <h3 className="ui-section-label pixel-label">Reset</h3>
        <div className="settings-action">
          <div className="settings-action-text">
            <strong>Reset workspace</strong>
            <span>Wipes every graph, node, and file, then reseeds a fresh Home — a snapshot is taken first.</span>
          </div>
          <button
            type="button"
            className="ui-button ui-button--danger"
            aria-label="Reset workspace"
            onClick={onReset}
          >
            Reset
          </button>
        </div>
      </section>
      <input
        ref={fileInput}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) onImportFile(file)
        }}
      />
    </>
  )
}
