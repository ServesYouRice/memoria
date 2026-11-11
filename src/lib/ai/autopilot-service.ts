export interface AutopilotAction {
  itemId: string;
  newPosition: { x: number; y: number };
  reason?: string;
}

/**
 * Canvas Autopilot: Automatically organizes canvas items.
 * Uses a simple clustering algorithm to group items.
 */
export async function calculateAutopilotLayout(
  items: any[],
): Promise<AutopilotAction[]> {
  if (items.length < 2) return [];

  const actions: AutopilotAction[] = [];

  // Simple Grid Layout Strategy for now
  // In a real implementation, this would use clustering (K-Means) or Force-Directed Graph layout
  // based on content similarity or proximity.

  const SPACING = 350; // Horizontal spacing including card width
  const NOTES_PER_ROW = 4;

  // Sort items by creation time (preserving some order)
  const sortedItems = [...items].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  sortedItems.forEach((item, index) => {
    const row = Math.floor(index / NOTES_PER_ROW);
    const col = index % NOTES_PER_ROW;

    const targetX = col * SPACING;
    const targetY = row * 250; // Vertical spacing

    // Only move if significantly different to avoid jitter for small adjustments
    if (
      Math.abs(item.positionX - targetX) > 10 ||
      Math.abs(item.positionY - targetY) > 10
    ) {
      actions.push({
        itemId: item.id,
        newPosition: { x: targetX, y: targetY },
        reason: "Grid alignment",
      });
    }
  });

  return actions;
}

/**
 * The most items one Autopilot apply can write: the canvas-items batch PATCH
 * accepts at most 500 positions per request.
 */
export const AUTOPILOT_MAX_ITEMS = 500;
const AUTOPILOT_PAGE_LIMIT = 200;

export class AutopilotTooLargeError extends Error {
  constructor(readonly total: number) {
    super(
      `Autopilot can organize at most ${AUTOPILOT_MAX_ITEMS} items at once; this canvas has ${total}.`,
    );
    this.name = "AutopilotTooLargeError";
  }
}

export interface AutopilotItem {
  id: string;
  version: number;
  positionX: number;
  positionY: number;
  createdAt: string;
}

interface CanvasItemsPage {
  items: AutopilotItem[];
  total?: number;
  hasMore: boolean;
  nextCursor?: string | null;
}

/**
 * Load every item of the canvas through the list API (no viewport), following
 * cursors to the end. The viewport-loaded board items are only a subset, and a
 * grid computed over a subset lands on top of the items it does not know.
 */
export async function loadAutopilotItems(
  canvasId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AutopilotItem[]> {
  const items: AutopilotItem[] = [];
  let cursor: string | null = null;
  const maxPages = Math.ceil(AUTOPILOT_MAX_ITEMS / AUTOPILOT_PAGE_LIMIT) + 2;
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      canvasId,
      limit: String(AUTOPILOT_PAGE_LIMIT),
    });
    if (cursor) params.set("cursor", cursor);
    const response = await fetchImpl(`/api/v1/canvas-items?${params}`);
    if (!response.ok) throw new Error("Failed to load canvas items");
    const body = (await response.json()) as CanvasItemsPage;
    if (typeof body.total === "number" && body.total > AUTOPILOT_MAX_ITEMS) {
      throw new AutopilotTooLargeError(body.total);
    }
    items.push(...body.items);
    if (items.length > AUTOPILOT_MAX_ITEMS) {
      throw new AutopilotTooLargeError(items.length);
    }
    if (!body.hasMore) return items;
    if (!body.nextCursor || body.items.length === 0) {
      throw new Error("Canvas items could not be loaded completely");
    }
    cursor = body.nextCursor;
  }
  throw new AutopilotTooLargeError(items.length);
}

/** The whole-canvas items and the layout computed over exactly that set. */
export async function prepareAutopilot(
  canvasId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ items: AutopilotItem[]; actions: AutopilotAction[] }> {
  const items = await loadAutopilotItems(canvasId, fetchImpl);
  return { items, actions: await calculateAutopilotLayout(items) };
}
