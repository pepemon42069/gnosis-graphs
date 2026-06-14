import { useSessionStore } from '../app/store'
import { visitDocs } from '../nav/history'
import { Icon } from '../ui/Icon'
import { FilesTree, NewFileButton } from './FilesTree'
import { GraphTree } from './GraphTree'
import './sidebar.css'

/** Persistent left chrome — never part of the escape() ladder. */
export function Sidebar() {
  const open = useSessionStore((s) => s.sidebarOpen)
  const setSidebarOpen = useSessionStore((s) => s.setSidebarOpen)
  const setSettingsOpen = useSessionStore((s) => s.setSettingsOpen)

  if (!open) {
    return (
      <nav className="sidebar sidebar--collapsed">
        <span className="sidebar-brand-icon" title="Gnosis Graphs" aria-hidden="true">
          <Icon name="brand" size={14} />
        </span>
        <button
          type="button"
          className="ui-button ui-button--ghost sidebar-icon sidebar-icon--push"
          aria-label="Documentation"
          title="Documentation"
          onClick={() => visitDocs()}
        >
          <Icon name="book" size={16} />
        </button>
        <button
          type="button"
          className="ui-button ui-button--ghost sidebar-icon"
          aria-label="Settings"
          title="Settings"
          onClick={() => setSettingsOpen(true)}
        >
          <Icon name="settings" size={16} />
        </button>
        <button
          type="button"
          className="ui-button ui-button--ghost sidebar-icon"
          aria-label="Expand sidebar"
          title="Expand sidebar"
          onClick={() => setSidebarOpen(true)}
        >
          <Icon name="chevron-right" size={16} />
        </button>
      </nav>
    )
  }
  return (
    <nav className="sidebar">
      <div className="sidebar-brand pixel-label">
        <span className="sidebar-brand-icon" aria-hidden="true">
          <Icon name="brand" size={14} />
        </span>
        Gnosis Graphs
      </div>
      <section className="sidebar-pane">
        <div className="sidebar-pane-header">
          <span className="sidebar-pane-label">Nodes</span>
        </div>
        <GraphTree />
      </section>
      <section className="sidebar-pane">
        <div className="sidebar-pane-header">
          <span className="sidebar-pane-label">Files</span>
          <NewFileButton />
        </div>
        <FilesTree />
      </section>
      <div className="sidebar-nav">
        <button type="button" className="sidebar-nav-item pixel" onClick={() => visitDocs()}>
          <Icon name="book" size={16} />
          Docs
        </button>
        <button
          type="button"
          className="sidebar-nav-item pixel"
          onClick={() => setSettingsOpen(true)}
        >
          <Icon name="settings" size={16} />
          Settings
        </button>
        <button
          type="button"
          className="sidebar-nav-item sidebar-nav-item--muted pixel"
          aria-label="Collapse sidebar"
          onClick={() => setSidebarOpen(false)}
        >
          <Icon name="chevron-left" size={16} />
          Collapse
        </button>
      </div>
    </nav>
  )
}
