import { ReactFlowProvider } from '@xyflow/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { useSessionStore } from './app/store'
import { connectEvents, fetchMeta, refreshVocab } from './data/client'
import { restoreNavigation } from './nav/history'
import { applyTheme } from './settings/theme'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/600.css'
import './index.css'
import './app/ui.css'

applyTheme()
const root = createRoot(document.getElementById('root')!)

// Self-hosted boot: open the SSE stream, load the workspace content + meta from
// the server, restore the saved navigation, render.
connectEvents()
await refreshVocab()
const meta = await fetchMeta()
document.title = 'gnosis-graphs'
useSessionStore.getState().setHomeGraphId(meta.homeGraphId)
await restoreNavigation(meta.initialGraphId ?? meta.homeGraphId ?? '')
root.render(
  <StrictMode>
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>
  </StrictMode>,
)
