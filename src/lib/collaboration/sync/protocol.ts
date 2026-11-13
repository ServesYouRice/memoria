/**
 * IMP-042 — the contract shared by the canvas client, the sync server, and the
 * HTTP routes for collaborative canvas documents.
 *
 * One Y.Doc per canvas; the Hocuspocus document name is the canvas id. The
 * root map `items` holds one nested Y.Map per live canvas item, keyed by the
 * `CanvasItem` id:
 *
 *   items: Y.Map<itemId, Y.Map>
 *     type                                    ItemType, fixed at creation
 *     positionX, positionY, width, height     finite numbers
 *     zIndex                                  integer
 *     tags                                    string[]
 *     content                                 JSON value, every type but NOTE
 *     text                                    Y.XmlFragment, NOTE only (TipTap)
 *     color                                   note colour name, NOTE only, optional
 *
 * Nothing else may appear in the document: the sync server rejects any update
 * that touches another root, another key, or a value of the wrong shape.
 *
 * @module lib/collaboration/sync/protocol
 */

/** Public WebSocket path. The app server and the gateway route it to the sync server. */
export const COLLABORATION_SYNC_PATH = "/api/collaboration/sync";

export const DOCUMENT_ITEMS_KEY = "items";
export const NOTE_TEXT_KEY = "text";
/** IMP-085: a note's colour, one of `NOTE_COLOR_NAMES`; absent means yellow. */
export const NOTE_COLOR_KEY = "color";

export const ITEM_GEOMETRY_KEYS = [
  "positionX",
  "positionY",
  "width",
  "height",
  "zIndex",
] as const;
export type ItemGeometryKey = (typeof ITEM_GEOMETRY_KEYS)[number];

/** Every key an item map may hold. */
export const ITEM_KEYS = new Set<string>([
  "type",
  ...ITEM_GEOMETRY_KEYS,
  "tags",
  "content",
  NOTE_TEXT_KEY,
  NOTE_COLOR_KEY,
]);

/**
 * Close reasons the sync server sends with a document-level close. Hocuspocus
 * delivers only the reason text to the provider, so the reason carries the
 * client's next step.
 */
export const SYNC_CLOSE_REASONS = {
  /** The update was refused: discard the local document and resync. */
  invalidUpdate: "memoria:invalid-update",
  /** Access is missing or was revoked: stop and do not reconnect. */
  forbidden: "memoria:forbidden",
  /** Persisting failed transiently: reconnect and resend local changes. */
  unavailable: "memoria:unavailable",
  /** The role changed (edit <-> read-only): reconnect to learn the new scope. */
  reauthenticate: "memoria:reauthenticate",
  /**
   * No valid session and no share token: keep the device copy and stop
   * until the user signs in again. Clients that do not know this reason
   * treat it as `forbidden`.
   */
  signedOut: "memoria:signed-out",
} as const;

export type SyncCloseReason =
  (typeof SYNC_CLOSE_REASONS)[keyof typeof SYNC_CLOSE_REASONS];

/** WebSocket close codes paired with the reasons above. */
export const SYNC_CLOSE_CODES = {
  invalidUpdate: 4400,
  signedOut: 4401,
  forbidden: 4403,
  reauthenticate: 4409,
  unavailable: 4503,
} as const;

// Prisma's cuid(): "c" followed by 24 lowercase base-36 characters.
const NEW_ITEM_ID = /^c[a-z0-9]{24}$/;
// Document names and existing item ids follow the routes' looser cuid check.
const CUID_LIKE = /^c[a-z0-9]{8,48}$/;

export function isCanvasDocumentName(name: string): boolean {
  return CUID_LIKE.test(name);
}

/** Ids a client may assign to an item it creates in the document. */
export function isNewCanvasItemId(id: string): boolean {
  return NEW_ITEM_ID.test(id);
}

export function isCanvasItemId(id: string): boolean {
  return CUID_LIKE.test(id);
}

/**
 * Client-side ids for items created in the document. They match Prisma's
 * cuid() shape; the sync server still refuses an id that already belongs to
 * another canvas.
 */
export function createCanvasItemId(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  let id = "c";
  for (const byte of bytes) id += (byte % 36).toString(36);
  return id;
}
