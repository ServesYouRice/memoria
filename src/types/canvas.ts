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

/**
 * Access level a viewer holds on a canvas, as returned by the canvas API and
 * by the server authorization layer.
 */
export type CanvasAccessLevel = "OWNER" | "EDIT" | "COMMENT" | "VIEW" | "NONE";

/**
 * IMP-008 — the one capability contract every canvas surface reads.
 *
 * These flags decide which interactions are offered *and* which optimistic
 * mutations may be created locally. They are a usability boundary, not a
 * security boundary: HTTP authorization remains the final word on every write.
 */
export interface CanvasCapabilities {
  canMoveItems: boolean;
  canResizeItems: boolean;
  canEditItems: boolean;
  canCreateItems: boolean;
  canDeleteItems: boolean;
  canCopyItems: boolean;
  canComment: boolean;
  /**
   * Poll voting. Held at `false` for every role until server-authoritative
   * voting ships (DEC-005) — no role may write a vote from the client.
   */
  canVote: boolean;
  canManageCanvas: boolean;
}

/**
 * Derive capabilities from an access level. This is the only place a role is
 * turned into permitted interactions.
 */
export function resolveCanvasCapabilities(
  accessLevel: CanvasAccessLevel,
): CanvasCapabilities {
  const canEdit = accessLevel === "OWNER" || accessLevel === "EDIT";
  const canComment = canEdit || accessLevel === "COMMENT";

  return {
    canMoveItems: canEdit,
    canResizeItems: canEdit,
    canEditItems: canEdit,
    canCreateItems: canEdit,
    canDeleteItems: canEdit,
    canCopyItems: accessLevel !== "NONE",
    canComment,
    // DEC-005: client-side voting is gated off until the server owns it.
    canVote: false,
    canManageCanvas: accessLevel === "OWNER",
  };
}

/** Capabilities granting nothing — the safe default before data loads. */
export const NO_CANVAS_CAPABILITIES: CanvasCapabilities =
  resolveCanvasCapabilities("NONE");

/**
 * The geometry an item commits after one gesture. Position is always present;
 * size is present only for a resize.
 */
export interface ItemGeometryCommit {
  positionX: number;
  positionY: number;
  width?: number;
  height?: number;
}

/**
 * Item types that expose resize handles. Everything else derives its size from
 * its content and is explicitly non-resizable.
 */
export const RESIZABLE_ITEM_TYPES: ReadonlySet<ItemType> = new Set([
  ItemType.NOTE,
  ItemType.BOOKMARK,
  ItemType.IMAGE,
]);

export function isItemResizable(type: ItemType): boolean {
  return RESIZABLE_ITEM_TYPES.has(type);
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
 * Required props for every canvas item adapter. Each item type renders itself,
 * but move/resize always leaves through `onCommitGeometry` so one gesture
 * produces exactly one durable write on the parent-owned path.
 */
export interface CanvasItemAdapterProps {
  item: CanvasItem;
  isSelected: boolean;
  capabilities: CanvasCapabilities;
  onSelect: () => void;
  onContextMenu: (event: unknown) => void;
  onCommitGeometry: (geometry: ItemGeometryCommit) => void;
  /** Double-click / Enter activation, when the type supports editing. */
  onActivate?: () => void;
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
