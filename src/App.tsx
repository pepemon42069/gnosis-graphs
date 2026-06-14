import { ContextMenu } from './app/ContextMenu'
import { TopBar } from './app/TopBar'
import { useSessionStore } from './app/store'
import { useContextMenuGuard } from './app/useContextMenuGuard'
import { CanvasView } from './canvas/CanvasView'
import { DocPage } from './doc/DocPage'
import { DocsView } from './docs/DocsView'
import { GraphSourceEditor } from './source/GraphSourceEditor'
import { useKeyboardMap } from './keyboard/useKeyboardMap'
import { ConfirmDialog } from './nav/ConfirmDialog'
import { PromptDialog } from './nav/PromptDialog'
import { useDrillTransition } from './nav/useDrillTransition'
import { useHistorySync } from './nav/useHistorySync'
import { SidePanel } from './panel/SidePanel'
import { Picker } from './picker/Picker'
import { SettingsModal } from './settings/SettingsModal'
import { Sidebar } from './sidebar/Sidebar'

function App() {
  useKeyboardMap()
  useHistorySync()
  useContextMenuGuard()
  const graphId = useSessionStore((s) => s.graphId)
  const docNodeId = useSessionStore((s) => s.docNodeId)
  const sourceMode = useSessionStore((s) => s.sourceMode)
  const docsOpen = useSessionStore((s) => s.docsOpen)
  const transition = useDrillTransition()
  if (!graphId) return null
  return (
    <main className="app">
      <div className="app-body">
        <Sidebar />
        <div className="app-main">
          <TopBar />
          <div className="main-area">
            <div className={`canvas-wrap ${transition.className}`} key={transition.key}>
              {docsOpen ? (
                <DocsView />
              ) : sourceMode ? (
                <GraphSourceEditor graphId={graphId} />
              ) : docNodeId ? (
                <DocPage nodeId={docNodeId} />
              ) : (
                <CanvasView graphId={graphId} />
              )}
            </div>
            <SidePanel />
          </div>
        </div>
      </div>
      <Picker />
      <ContextMenu />
      <SettingsModal />
      <ConfirmDialog />
      <PromptDialog />
    </main>
  )
}

export default App
