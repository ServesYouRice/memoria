/**
 * Canvas UI State Store
 *
 * Zustand store for managing ephemeral canvas UI state including viewport,
 * tool selection, and item selection. Follows strict separation of concerns.
 *
 * @module stores/canvasStore
 *
 * ## Architecture
 * Per ADR-0005 (State Management Policy):
 * - **This store**: Ephemeral UI state (zoom, pan, selection, active tool)
 * - **TanStack Query**: Server-persisted data (canvases, items)
 * - **Separation**: UI state here, server state in hooks
 *
 * ## State Management
 * - `currentZoom/Pan`: Live viewport state, updated during pan/zoom gestures
 * - `activeTool`: Currently selected tool (select, pan, note, bookmark)
 * - `selectedItemId`: Currently selected canvas item for editing
 * - `contextMenu`: Position and visibility of right-click menu
 *
 * ## Persistence
 * Viewport state (zoom/pan) is persisted to server via debounced mutations
 * when user stops interacting. Current state here is source of truth for UI.
 *
 * @example
 * ```typescript
 * function CanvasToolbar() {
 *   const { activeTool, setActiveTool } = useCanvasStore();
 *
 *   return (
 *     <div>
 *       <button
 *         onClick={() => setActiveTool('select')}
 *         className={activeTool === 'select' ? 'active' : ''}
 *       >
 *         Select
 *       </button>
 *       <button
 *         onClick={() => setActiveTool('note')}
 *         className={activeTool === 'note' ? 'active' : ''}
 *       >
 *         Add Note
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @see {@link useCanvas} for server-persisted canvas data
 * @see {@link useCanvasItems} for canvas items data
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

/**
 * Available canvas tools for user interaction
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
    persist(
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
      {
        name: 'canvas-preferences',
        // Only persist activeTool preference, not ephemeral state
        partialize: (state) => ({ activeTool: state.activeTool }),
      }
    ),
    { name: 'CanvasStore' }
  )
);
