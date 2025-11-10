/**
 * Shared types for Canvas Items
 * Based on ADR-0004: Data Model
 */

export enum ItemType {
  NOTE = 'NOTE',
  BOOKMARK = 'BOOKMARK',
  IMAGE = 'IMAGE',
}

/**
 * Base geometry for all canvas items
 */
export interface ItemGeometry {
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  zIndex: number;
}

/**
 * Note item content
 */
export interface NoteContent {
  text: string;
}

/**
 * Bookmark item content
 * Note: Unfurling (title, description, favicon, preview image) is Phase 2
 * For MVP, we only store the URL
 */
export interface BookmarkContent {
  url: string;
  // Phase 2 fields (not implemented in MVP):
  // title?: string;
  // description?: string;
  // favicon?: string;
  // previewImage?: string;
  // unfurledAt?: string;
}

/**
 * Image item content
 */
export interface ImageContent {
  url: string; // URL to the uploaded image
  filename: string; // Original filename
  alt?: string; // Alternative text for accessibility
  width?: number; // Original image width
  height?: number; // Original image height
}

/**
 * Union type for all item content types
 */
export type ItemContent = NoteContent | BookmarkContent | ImageContent;

/**
 * Full canvas item (matches database schema)
 */
export interface CanvasItem {
  id: string;
  canvasId: string;
  type: ItemType;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  zIndex: number;
  content: ItemContent;
  tags: string[];
  version: number;
  deletedAt: Date | null;
  createdById: string;
  updatedById: string | null;
  deletedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Canvas item for client-side rendering
 */
export interface ClientCanvasItem
  extends Omit<CanvasItem, 'createdAt' | 'updatedAt' | 'deletedAt'> {
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * Type guards
 */
export function isNoteContent(content: ItemContent): content is NoteContent {
  return 'text' in content;
}

export function isBookmarkContent(content: ItemContent): content is BookmarkContent {
  return 'url' in content && !('filename' in content);
}

export function isImageContent(content: ItemContent): content is ImageContent {
  return 'url' in content && 'filename' in content;
}

/**
 * Canvas viewport state
 */
export interface CanvasViewport {
  zoomLevel: number;
  panX: number;
  panY: number;
}
