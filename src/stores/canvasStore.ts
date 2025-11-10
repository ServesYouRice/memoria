import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

/**
 * Canvas UI State Store
 *
 * Per ADR-0005 (State Management Policy):
 * - This store manages ONLY ephemeral UI state
 * - Server-persisted data (canvases, items) is managed by TanStack Query
 * - Current zoom/pan positions are stored here for UI reactivity
 * - Persisted zoom/pan is saved via debounced mutations
 */

export type CanvasTool = 'select' | 'pan' | 'note' | 'bookmark';

interface CanvasUIState {
  // Current view state (ephemeral, updated frequently during interactions)
  currentZoom: number;
  currentPanX: number;
  currentPanY: number;

  // Active tool
  activeTool: CanvasTool;

  // Selection state
  selectedItemId: string | null;

  // UI element states
  isContextMenuOpen: boolean;
  contextMenuPosition: { x: number; y: number } | null;

  // Actions
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  setActiveTool: (tool: CanvasTool) => void;
  setSelectedItem: (id: string | null) => void;
  openContextMenu: (x: number, y: number) => void;
  closeContextMenu: () => void;
  resetView: () => void;
}

export const useCanvasStore = create<CanvasUIState>()(
  devtools(
    (set) => ({
      // Initial state
      currentZoom: 1.0,
      currentPanX: 0,
      currentPanY: 0,
      activeTool: 'select',
      selectedItemId: null,
      isContextMenuOpen: false,
      contextMenuPosition: null,

      // Actions
      setZoom: (zoom) => set({ currentZoom: zoom }),

      setPan: (x, y) => set({ currentPanX: x, currentPanY: y }),

      setActiveTool: (tool) => set({ activeTool: tool }),

      setSelectedItem: (id) => set({ selectedItemId: id }),

      openContextMenu: (x, y) => set({ isContextMenuOpen: true, contextMenuPosition: { x, y } }),

      closeContextMenu: () => set({ isContextMenuOpen: false, contextMenuPosition: null }),

      resetView: () =>
        set({
          currentZoom: 1.0,
          currentPanX: 0,
          currentPanY: 0,
          selectedItemId: null,
        }),
    }),
    { name: 'CanvasStore' }
  )
);
