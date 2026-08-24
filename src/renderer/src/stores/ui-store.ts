import { create } from 'zustand'

interface UiState {
  paletteOpen: boolean
  settingsOpen: boolean
  showTerminal: boolean
  /** Height of the bottom terminal panel in px (drag-resizable). */
  terminalHeight: number
  /** Width of the primary sidebar in px (drag-resizable). */
  sidebarWidth: number
  addClusterOpen: boolean
  /** When true, destructive mutations (delete / rolling restart) are blocked. */
  readOnly: boolean
  /** Live-update stream state, driven by the resource informers (M1). `idle` when
   *  no list is being watched (e.g. plain browser); the status bar hides it. */
  liveStatus: 'idle' | 'connecting' | 'connected' | 'error'
  setPaletteOpen: (open: boolean) => void
  togglePalette: () => void
  setSettingsOpen: (open: boolean) => void
  toggleTerminal: () => void
  setShowTerminal: (open: boolean) => void
  setTerminalHeight: (height: number) => void
  setSidebarWidth: (width: number) => void
  setAddClusterOpen: (open: boolean) => void
  toggleReadOnly: () => void
  setLiveStatus: (liveStatus: UiState['liveStatus']) => void
}

export const useUiStore = create<UiState>((set) => ({
  paletteOpen: false,
  settingsOpen: false,
  showTerminal: false,
  terminalHeight: 280,
  sidebarWidth: 280,
  addClusterOpen: false,
  readOnly: false,
  liveStatus: 'idle',
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  toggleTerminal: () => set((s) => ({ showTerminal: !s.showTerminal })),
  setShowTerminal: (showTerminal) => set({ showTerminal }),
  setTerminalHeight: (terminalHeight) => set({ terminalHeight }),
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
  setAddClusterOpen: (addClusterOpen) => set({ addClusterOpen }),
  toggleReadOnly: () => set((s) => ({ readOnly: !s.readOnly })),
  setLiveStatus: (liveStatus) => set({ liveStatus })
}))
