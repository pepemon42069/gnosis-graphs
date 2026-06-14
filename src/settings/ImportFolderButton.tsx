import { useRef } from 'react'
import { useSessionStore } from '../app/store'
import { runCommand } from '../data/client'
import type { MarkdownFile } from '../data/interop/markdownImport'
import { visit } from '../nav/history'

async function importFolder(fileList: File[]): Promise<void> {
  const mdFiles = fileList.filter((f) => f.name.toLowerCase().endsWith('.md'))
  if (mdFiles.length === 0) {
    window.alert('No .md files found in that folder')
    return
  }
  const files: MarkdownFile[] = await Promise.all(
    mdFiles.map(async (f) => ({ name: f.name, text: await f.text() })),
  )
  const folder = mdFiles[0]?.webkitRelativePath.split('/')[0]
  useSessionStore.getState().requestPrompt({
    message: 'Import into new graph',
    initialValue: folder || 'Imported notes',
    submitLabel: 'Import',
    onSubmit: (name) => {
      void (async () => {
        try {
          const result = await runCommand('import-markdown-folder', { graphName: name, files })
          // Hosted in Settings → Data now: close the modal, then lateral jump (§4).
          useSessionStore.getState().setSettingsOpen(false)
          visit(result.graphId!, [result.graphId!])
        } catch (error: unknown) {
          window.alert(error instanceof Error ? error.message : String(error))
        }
      })()
    },
  })
}

export function ImportFolderButton() {
  const input = useRef<HTMLInputElement>(null)

  return (
    <>
      <button
        type="button"
        className="ui-button"
        aria-label="Import markdown folder"
        onClick={() => input.current?.click()}
      >
        Import…
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept=".md,text/markdown"
        hidden
        // webkitdirectory is absent from React's input types; spread it through.
        {...{ webkitdirectory: '' }}
        onChange={(e) => {
          // Snapshot first: FileList is live and clearing the input empties it.
          const files = e.target.files ? [...e.target.files] : []
          e.target.value = ''
          if (files.length) {
            importFolder(files).catch((error: unknown) => {
              window.alert(error instanceof Error ? error.message : String(error))
            })
          }
        }}
      />
    </>
  )
}
