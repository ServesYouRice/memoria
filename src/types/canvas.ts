/**
 * Shared types for Canvas Items
 * Based on ADR-0004: Data Model
 */

export enum ItemType {
  NOTE = "NOTE",
  BOOKMARK = "BOOKMARK",
  IMAGE = "IMAGE",
  DRAWING = "DRAWING",
  SHAPE = "SHAPE",
  ARROW = "ARROW",
  TEXT = "TEXT",
  FRAME = "FRAME",
  EMBED = "EMBED",
  POLL = "POLL",
}

/** Access level used by both the server authorization layer and the canvas UI. */
export type CanvasAccessLevel = "OWNER" | "EDIT" | "COMMENT" | "VIEW" | "NONE";

/** Client-side capabilities. These are affordance hints, never an auth boundary. */
export interface CanvasCapabilities {
  canCreateItems: boolean;
  canEditItems: boolean;
  canMoveItems: boolean;
  canResizeItems: boolean;
  canDeleteItems: boolean;
  canCopyItems: boolean;
  canComment: boolean;
  canVote: boolean;
  canManageCanvas: boolean;
}

/** The fields a single move or resize gesture may commit. */
export interface ItemGeometryCommit {
  positionX: number;
  positionY: number;
  width?: number;
  height?: number;
}

/** Adapter contract shared by every interactive item renderer. */
export type CommitItemGeometry = (
  item: CanvasItem,
  geometry: ItemGeometryCommit,
) => void;

/** Only item renderers with resize handles belong in this set. */
export const RESIZABLE_ITEM_TYPES: ReadonlySet<ItemType> = new Set([
  ItemType.NOTE,
  ItemType.BOOKMARK,
  ItemType.IMAGE,
]);

export function isItemResizable(type: ItemType): boolean {
  return RESIZABLE_ITEM_TYPES.has(type);
}

/** Resolve the UI affordances for a server-provided canvas access level. */
export function resolveCanvasCapabilities(
  accessLevel: CanvasAccessLevel,
): CanvasCapabilities {
  const canEditItems = accessLevel === "OWNER" || accessLevel === "EDIT";
  const canComment =
    accessLevel === "OWNER" ||
    accessLevel === "EDIT" ||
    accessLevel === "COMMENT";

  return {
    canCreateItems: canEditItems,
    canEditItems,
    canMoveItems: canEditItems,
    canResizeItems: canEditItems,
    canDeleteItems: canEditItems,
    canCopyItems: accessLevel !== "NONE",
    canComment,
    // Voting remains disabled until server-authoritative voting is shipped.
    canVote: false,
    canManageCanvas: accessLevel === "OWNER",
  };
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
  formatVersion?: 1;
  document?: Record<string, unknown>;
  plainText?: string;
}

/**
 * Bookmark item content
 * Includes unfurled metadata from the URL
 */
export interface BookmarkContent {
  url: string;
  title?: string;
  description?: string;
  favicon?: string;
  previewImage?: string;
  siteName?: string;
  unfurledAt?: string;
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
 * Single stroke path for drawing
 */
export interface DrawingPath {
  points: number[];
  stroke: string;
  strokeWidth: number;
  opacity?: number;
  tension?: number;
}

/**
 * Drawing item content (collection of paths)
 */
export interface DrawingContent {
  paths: DrawingPath[];
}

/**
 * Shape item content
 */
export interface ShapeContent {
  shapeType:
    "rectangle" | "circle" | "triangle" | "diamond" | "star" | "arrow_shape";
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  radius?: number; // For rounded corners or circle radius
}

/**
 * Arrow connector content
 */
export interface ArrowContent {
  startItemId?: string;
  endItemId?: string;
  startPoint?: { x: number; y: number };
  endPoint?: { x: number; y: number };
  stroke?: string;
  strokeWidth?: number;
  arrowHeadStart?: "none" | "arrow" | "circle";
  arrowHeadEnd?: "none" | "arrow" | "circle";
  label?: string;
}

/**
 * Text item content
 */
export interface TextContent {
  text: string;
  fontSize?: number;
  fontFamily?: string;
  align?: "left" | "center" | "right";
  color?: string;
}

/**
 * Frame item content
 */
export interface FrameContent {
  title?: string;
  backgroundColor?: string;
}

/**
 * Embed item content
 */
export interface EmbedContent {
  url: string;
  embedType: "youtube" | "figma" | "loom" | "generic";
}

/**
 * Poll item content
 */
export interface PollOption {
  id: string;
  text: string;
  votes: string[]; // Array of user IDs
}

export interface PollContent {
  question: string;
  options: PollOption[];
  multipleChoice?: boolean; // Default false (single choice)
}

/**
 * Union type for all item content types
 */
export type ItemContent =
  | NoteContent
  | BookmarkContent
  | ImageContent
  | DrawingContent
  | ShapeContent
  | ArrowContent
  | TextContent
  | FrameContent
  | EmbedContent
  | PollContent;

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
export interface ClientCanvasItem extends Omit<
  CanvasItem,
  "createdAt" | "updatedAt" | "deletedAt"
> {
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * Type guards for canvas item content
 * Canvas item type guards.
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
  return "text" in content;
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
export function isBookmarkContent(
  content: ItemContent,
): content is BookmarkContent {
  return "url" in content && !("filename" in content);
}

export function isImageContent(content: ItemContent): content is ImageContent {
  return "url" in content && "filename" in content;
}

export function isDrawingContent(
  content: ItemContent,
): content is DrawingContent {
  return "paths" in content;
}

export function isShapeContent(content: ItemContent): content is ShapeContent {
  return "shapeType" in content;
}

export function isArrowContent(content: ItemContent): content is ArrowContent {
  return "startItemId" in content || "startPoint" in content;
}

export function isTextContent(content: ItemContent): content is TextContent {
  // Distinguish from NoteContent which also has 'text' but might be structurally different in future.
  // For now, if we use a discriminator field in types it would be safer.
  // Assuming NoteContent is specifically for sticky notes and TextContent for standalone text.
  // We might need a better guard if they overlap. For now simple check.
  // CHECK: NoteContent has 'text' only?
  return "text" in content && "fontSize" in content;
}

export function isFrameContent(content: ItemContent): content is FrameContent {
  return (
    "backgroundColor" in content || ("title" in content && !("url" in content))
  );
}

export function isEmbedContent(content: ItemContent): content is EmbedContent {
  return "embedType" in content;
}

export function isPollContent(content: ItemContent): content is PollContent {
  return "question" in content && "options" in content;
}

/**
 * Canvas viewport state
 */
export interface CanvasViewport {
  zoomLevel: number;
  panX: number;
  panY: number;
}

/**
 * Canvas entity type
 */
export interface Canvas {
  id: string;
  name: string;
  userId: string;
  isPublic: boolean;
  zoomLevel: number;
  panX: number;
  panY: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Payload for updating a canvas
 */
export interface CanvasUpdatePayload {
  name?: string;
  isPublic?: boolean;
  zoomLevel?: number;
  panX?: number;
  panY?: number;
}
