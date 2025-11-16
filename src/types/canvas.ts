/**
 * Shared types for Canvas Items
 * Based on ADR-0004: Data Model
 */

export enum ItemType {
  NOTE = 'NOTE',
  BOOKMARK = 'BOOKMARK',
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
 * Union type for all item content types
 */
export type ItemContent = NoteContent | BookmarkContent;

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
 * Type guards for canvas item content
 * FIXED: Issue #38 - Added JSDoc to complex functions
 */

/**
 * Type guard to check if content is a NoteContent object
 *
 * @param content - The content object to check
 * @returns True if content has a 'text' property, indicating it's a NoteContent
 * @example
 * ```typescript
 * if (isNoteContent(item.content)) {
 *   console.log(item.content.text); // TypeScript knows this is safe
 * }
 * ```
 */
export function isNoteContent(content: ItemContent): content is NoteContent {
  return 'text' in content;
}

/**
 * Type guard to check if content is a BookmarkContent object
 *
 * @param content - The content object to check
 * @returns True if content has a 'url' property, indicating it's a BookmarkContent
 * @example
 * ```typescript
 * if (isBookmarkContent(item.content)) {
 *   console.log(item.content.url); // TypeScript knows this is safe
 * }
 * ```
 */
export function isBookmarkContent(content: ItemContent): content is BookmarkContent {
  return 'url' in content;
}

/**
 * Canvas viewport state
 */
export interface CanvasViewport {
  zoomLevel: number;
  panX: number;
  panY: number;
}
