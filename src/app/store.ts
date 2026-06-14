import type { Viewport } from '@xyflow/react'
import { create } from 'zustand'
import type {
  ConfirmRequest,
  ContextMenuState,
  PendingEdge,
  PickerState,
  PromptRequest,
  Selection,
} from './types'

interface SessionState {
  graphId: string | null
  homeGraphId: string | null
  trail: string[]
  /** MRU graph ids this session — ranks Mod+K placement jumps (§7). */
  recentGraphIds: string[]
  /** Per-graph camera, session-only: restored on return so navigation never
      auto-fits (§4); a graph fits only on its first visit (no entry yet). */
  graphViewports: Record<string, Viewport>
  selection: Selection
  /** Canvas tag filter (OR semantics): empty shows all; else only nodes with any of
      these tags are rendered. Session-only, reset per graph. */
  tagFilter: string[]
  panelNodeId: string | null
  panelWidth: number
  picker: PickerState | null
  pendingEdge: PendingEdge | null
  confirm: ConfirmRequest | null
  /** Themed text prompt — the in-app replacement for window.prompt. */
  prompt: PromptRequest | null
  /** Custom right-click menu — closes itself on click-away/Escape. */
  contextMenu: ContextMenuState | null
  /** Settings modal (§5) — handles its own keys, so escape() skips it. */
  settingsOpen: boolean
  /** Consumed once by the canvas after a jump, to center and select a node. */
  pendingFocusNodeId: string | null
  /** Document page for one node (§WS-3); set ONLY via the history funnel, like graphId. */
  docNodeId: string | null
  /** DSL source editor over the current graph (Phase 2); set ONLY via the history funnel. */
  sourceMode: boolean
  /** In-app documentation viewer (full-page); set ONLY via the history funnel, like sourceMode. */
  docsOpen: boolean
  /** Payload area edit/preview toggle — a session preference, not per node. */
  payloadView: 'edit' | 'preview'
  /** Markdown doc-page layout — a session preference, like payloadView. */
  docLayout: 'write' | 'split' | 'preview'
  /** Left sidebar (persistent chrome, not in the escape() ladder) — sticky across sessions. */
  sidebarOpen: boolean

  setGraph(graphId: string, trail: string[]): void
  setGraphViewport(graphId: string, viewport: Viewport): void
  setHomeGraphId(graphId: string | null): void
  setSelection(selection: Selection): void
  clearSelection(): void
  toggleTagFilter(tag: string): void
  clearTagFilter(): void
  openPanel(nodeId: string): void
  closePanel(): void
  setPanelWidth(width: number): void
  openPicker(picker: PickerState): void
  closePicker(opts: { cancelEdge: boolean }): void
  beginEdge(fromNodeId: string): void
  completeEdgeTarget(toNodeId: string): void
  clearPendingEdge(): void
  requestConfirm(confirm: ConfirmRequest): void
  clearConfirm(): void
  requestPrompt(prompt: PromptRequest): void
  clearPrompt(): void
  openContextMenu(menu: ContextMenuState): void
  closeContextMenu(): void
  setSettingsOpen(open: boolean): void
  setPendingFocusNode(nodeId: string | null): void
  setDoc(nodeId: string | null): void
  setSourceMode(on: boolean): void
  setDocsOpen(on: boolean): void
  setPayloadView(view: 'edit' | 'preview'): void
  setDocLayout(layout: 'write' | 'split' | 'preview'): void
  setSidebarOpen(open: boolean): void
  /** Innermost-first dismissal for surfaces without local key handling: panel, then selection. */
  escape(): boolean
}

const EMPTY_SELECTION: Selection = { nodeIds: [], edgeIds: [] }

export const useSessionStore = create<SessionState>()((set, get) => {
  /** Enter a full-page overlay: clear all three overlay flags + the shared
      reset, then apply the caller's differing field(s) (mutually exclusive). */
  const enterOverlay = (patch: Partial<SessionState>) =>
    set({
      docNodeId: null,
      sourceMode: false,
      docsOpen: false,
      selection: EMPTY_SELECTION,
      panelNodeId: null,
      picker: null,
      pendingEdge: null,
      ...patch,
    })

  return {
    graphId: null,
    homeGraphId: null,
    trail: [],
    recentGraphIds: [],
    graphViewports: {},
    selection: EMPTY_SELECTION,
    tagFilter: [],
    panelNodeId: null,
    panelWidth: 380,
    picker: null,
    pendingEdge: null,
    confirm: null,
    prompt: null,
    contextMenu: null,
    settingsOpen: false,
    pendingFocusNodeId: null,
    docNodeId: null,
    sourceMode: false,
    docsOpen: false,
    payloadView: 'edit',
    docLayout: 'split',
    sidebarOpen:
      typeof localStorage === 'undefined' || localStorage.getItem('gnosis.sidebarOpen') !== '0',

    setGraph: (graphId, trail) =>
      set((s) => ({
        graphId,
        trail,
        recentGraphIds: [graphId, ...s.recentGraphIds.filter((id) => id !== graphId)].slice(0, 20),
        selection: EMPTY_SELECTION,
        tagFilter: [],
        panelNodeId: null,
        picker: null,
        pendingEdge: null,
        docNodeId: null,
        sourceMode: false,
        docsOpen: false,
      })),
    setGraphViewport: (graphId, viewport) =>
      set((s) => ({ graphViewports: { ...s.graphViewports, [graphId]: viewport } })),
    setHomeGraphId: (homeGraphId) => set({ homeGraphId }),
    setSelection: (selection) =>
      set({
        selection,
        panelNodeId: selection.nodeIds.length === 1 ? (selection.nodeIds[0] ?? null) : null,
      }),
    clearSelection: () => set({ selection: EMPTY_SELECTION, panelNodeId: null }),
    toggleTagFilter: (tag) =>
      set((s) => ({
        tagFilter: s.tagFilter.includes(tag)
          ? s.tagFilter.filter((t) => t !== tag)
          : [...s.tagFilter, tag],
      })),
    clearTagFilter: () => set({ tagFilter: [] }),
    // Never over the same node's doc page — two live editors would clobber saves.
    openPanel: (nodeId) => set((s) => (s.docNodeId === nodeId ? {} : { panelNodeId: nodeId })),
    closePanel: () => set({ panelNodeId: null }),
    setPanelWidth: (width) => set({ panelWidth: Math.max(260, Math.min(720, width)) }),
    openPicker: (picker) => set({ picker }),
    closePicker: ({ cancelEdge }) => set(cancelEdge ? { picker: null, pendingEdge: null } : { picker: null }),
    beginEdge: (fromNodeId) => set({ pendingEdge: { fromNodeId } }),
    completeEdgeTarget: (toNodeId) =>
      set((s) => (s.pendingEdge ? { pendingEdge: { ...s.pendingEdge, toNodeId } } : {})),
    clearPendingEdge: () => set({ pendingEdge: null }),
    requestConfirm: (confirm) => set({ confirm }),
    clearConfirm: () => set({ confirm: null }),
    requestPrompt: (prompt) => set({ prompt }),
    clearPrompt: () => set({ prompt: null }),
    openContextMenu: (contextMenu) => set({ contextMenu }),
    closeContextMenu: () => set({ contextMenu: null }),
    setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
    setPendingFocusNode: (nodeId) => set({ pendingFocusNodeId: nodeId }),
    setDoc: (docNodeId) => (docNodeId ? enterOverlay({ docNodeId }) : set({ docNodeId: null })),
    setSourceMode: (on) => (on ? enterOverlay({ sourceMode: true }) : set({ sourceMode: false })),
    // Full-page docs viewer — mutually exclusive with the doc page and source editor.
    setDocsOpen: (on) => (on ? enterOverlay({ docsOpen: true }) : set({ docsOpen: false })),
    setPayloadView: (payloadView) => set({ payloadView }),
    setDocLayout: (docLayout) => set({ docLayout }),
    setSidebarOpen: (sidebarOpen) => {
      localStorage.setItem('gnosis.sidebarOpen', sidebarOpen ? '1' : '0')
      set({ sidebarOpen })
    },

    escape: () => {
      const s = get()
      // The doc page sits between settings and panel in the ladder, but closing it
      // is a navigation — useKeyboardMap handles it (the store can't import history).
      // The modal handles its own keys when focused; this catches body-focused
      // Escape so it never falls through to the panel underneath.
      if (s.settingsOpen) {
        set({ settingsOpen: false })
        return true
      }
      if (s.panelNodeId) {
        set({ panelNodeId: null })
        return true
      }
      if (s.selection.nodeIds.length || s.selection.edgeIds.length) {
        set({ selection: EMPTY_SELECTION })
        return true
      }
      return false
    },
  }
})
