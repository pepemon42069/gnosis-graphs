import { useState } from 'react'
import { useSessionStore } from '../app/store'
import { useContentStore } from '../data/react/contentStore'
import type { NodeRecord } from '../data/types'
import { PanelHeader } from './PanelHeader'
import { PayloadEditor } from './PayloadEditor'
import { usePanelResize } from './usePanelResize'
import './panel.css'

/** Right-docked, resizable payload panel (§6). Rendered by App while panelNodeId is set. */
export function SidePanel() {
  const nodeId = useSessionStore((s) => s.panelNodeId)
  const width = useSessionStore((s) => s.panelWidth)
  const node = useContentStore((s) => (nodeId ? s.nodes.get(nodeId) : undefined))
  const resizeHandlers = usePanelResize()
  if (!node) return null
  return (
    <aside className="side-panel" style={{ width }}>
      <div className="side-panel-resize" {...resizeHandlers} />
      {/* Keyed by node id: each node remounts fresh as a collapsed reading card. */}
      <PanelBody key={node.id} node={node} />
    </aside>
  )
}

function PanelBody({ node }: { node: NodeRecord }) {
  const [controlsOpen, setControlsOpen] = useState(false)
  return (
    <>
      <PanelHeader node={node} open={controlsOpen} onToggle={() => setControlsOpen((open) => !open)} />
      <PayloadEditor node={node} />
    </>
  )
}
