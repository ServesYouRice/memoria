import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '../canvasStore';

/**
 * Unit tests for Canvas Store
 *
 * Tests ephemeral UI state management per ADR-0005
 */
describe('canvasStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useCanvasStore.setState({
      currentZoom: 1.0,
      currentPanX: 0,
      currentPanY: 0,
      activeTool: 'select',
      selectedItemId: null,
      isContextMenuOpen: false,
      contextMenuPosition: null,
    });
  });

  describe('zoom management', () => {
    it('should initialize with zoom level 1.0', () => {
      const { currentZoom } = useCanvasStore.getState();
      expect(currentZoom).toBe(1.0);
    });

    it('should update zoom level', () => {
      const { setZoom } = useCanvasStore.getState();
      setZoom(1.5);

      const { currentZoom } = useCanvasStore.getState();
      expect(currentZoom).toBe(1.5);
    });
  });

  describe('pan management', () => {
    it('should initialize with pan position (0, 0)', () => {
      const { currentPanX, currentPanY } = useCanvasStore.getState();
      expect(currentPanX).toBe(0);
      expect(currentPanY).toBe(0);
    });

    it('should update pan position', () => {
      const { setPan } = useCanvasStore.getState();
      setPan(100, 200);

      const { currentPanX, currentPanY } = useCanvasStore.getState();
      expect(currentPanX).toBe(100);
      expect(currentPanY).toBe(200);
    });
  });

  describe('tool management', () => {
    it('should initialize with select tool', () => {
      const { activeTool } = useCanvasStore.getState();
      expect(activeTool).toBe('select');
    });

    it('should switch to pan tool', () => {
      const { setActiveTool } = useCanvasStore.getState();
      setActiveTool('pan');

      const { activeTool } = useCanvasStore.getState();
      expect(activeTool).toBe('pan');
    });

    it('should switch to note tool', () => {
      const { setActiveTool } = useCanvasStore.getState();
      setActiveTool('note');

      const { activeTool } = useCanvasStore.getState();
      expect(activeTool).toBe('note');
    });
  });

  describe('selection management', () => {
    it('should initialize with no selection', () => {
      const { selectedItemId } = useCanvasStore.getState();
      expect(selectedItemId).toBeNull();
    });

    it('should select an item', () => {
      const { setSelectedItem } = useCanvasStore.getState();
      setSelectedItem('item-123');

      const { selectedItemId } = useCanvasStore.getState();
      expect(selectedItemId).toBe('item-123');
    });

    it('should deselect an item', () => {
      const { setSelectedItem } = useCanvasStore.getState();
      setSelectedItem('item-123');
      setSelectedItem(null);

      const { selectedItemId } = useCanvasStore.getState();
      expect(selectedItemId).toBeNull();
    });
  });

  describe('context menu management', () => {
    it('should initialize with context menu closed', () => {
      const { isContextMenuOpen, contextMenuPosition } = useCanvasStore.getState();
      expect(isContextMenuOpen).toBe(false);
      expect(contextMenuPosition).toBeNull();
    });

    it('should open context menu at position', () => {
      const { openContextMenu } = useCanvasStore.getState();
      openContextMenu(100, 200);

      const { isContextMenuOpen, contextMenuPosition } = useCanvasStore.getState();
      expect(isContextMenuOpen).toBe(true);
      expect(contextMenuPosition).toEqual({ x: 100, y: 200 });
    });

    it('should close context menu', () => {
      const { openContextMenu, closeContextMenu } = useCanvasStore.getState();
      openContextMenu(100, 200);
      closeContextMenu();

      const { isContextMenuOpen, contextMenuPosition } = useCanvasStore.getState();
      expect(isContextMenuOpen).toBe(false);
      expect(contextMenuPosition).toBeNull();
    });
  });

  describe('resetView', () => {
    it('should reset view to defaults', () => {
      const { setZoom, setPan, setSelectedItem, resetView } = useCanvasStore.getState();

      // Make some changes
      setZoom(2.0);
      setPan(100, 200);
      setSelectedItem('item-123');

      // Reset view
      resetView();

      const { currentZoom, currentPanX, currentPanY, selectedItemId } = useCanvasStore.getState();
      expect(currentZoom).toBe(1.0);
      expect(currentPanX).toBe(0);
      expect(currentPanY).toBe(0);
      expect(selectedItemId).toBeNull();
    });
  });
});
