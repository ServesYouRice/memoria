/**
 * Canvas Hooks Index
 * 
 * Centralized exports for all canvas-related hooks.
 */

// Data & State
export { useCanvasData } from './use-canvas-data';
export { useCanvasStore } from '@/stores/canvasStore';

// Interactions
export { useCanvasInteraction } from './use-canvas-interaction';
export { useCanvasKeyboard } from './use-canvas-keyboard';
export { useCanvasSelection } from './use-canvas-selection';
export { useSelectionBox } from '@/lib/hooks/use-selection-box';
export { useDrawingInteraction } from './use-drawing-interaction';

// UI State (Extracted from CanvasBoard)
export { useCanvasDialogs, type CanvasDialogsState } from './use-canvas-dialogs';
export { useCanvasChat, type CanvasChatState } from './use-canvas-chat';
export { useCanvasItemHandlers, type CanvasItemHandlers } from './use-canvas-item-handlers';
export { useCanvasAlignment, type CanvasAlignmentHandlers, type AlignmentType, type DistributionType } from './use-canvas-alignment';
export { useCanvasContextMenu, type ContextMenuHandlers, type ContextMenuPosition } from './use-canvas-context-menu';

// AI & Collaboration (NEW)
export { useCanvasAIHandlers } from './use-canvas-ai-handlers';
export { useCanvasCollaborationUI } from './use-canvas-collaboration-ui';
export { useCanvasThumbnail } from './use-canvas-thumbnail';
