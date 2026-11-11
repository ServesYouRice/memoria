import { createContext } from "react";
import {
  type CanvasItem,
  ItemType,
  isNoteContent,
  isTextContent,
  isBookmarkContent,
  isImageContent,
  type NoteContent,
  type TextContent,
  type BookmarkContent,
  type ImageContent,
} from "@/types/canvas";
import { apiFetch } from "@/lib/api/fetch-client";
import { toImageProxyUrl } from "@/lib/images/proxy-url";

/** A canvas larger than this many listing pages fails the export loudly. */
const MAX_EXPORT_PAGES = 200;
const EXPORT_PAGE_LIMIT = 500;

interface CanvasItemListPage {
  items: CanvasItem[];
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * Every live item of the canvas, for file exports. The board's own `items`
 * are a viewport-bounded, tag-filtered working set, so the export walks the
 * full listing (no viewport or tag params) to the last cursor page. Rows the
 * board holds are overlaid so unsaved live edits and local creations are
 * included. Throws instead of returning a partial list.
 */
export async function fetchAllCanvasItems(
  canvasId: string,
  liveItems: CanvasItem[] = [],
): Promise<CanvasItem[]> {
  const fetched: CanvasItem[] = [];
  let cursor: string | null = null;
  for (let page = 0; ; page++) {
    if (page >= MAX_EXPORT_PAGES) {
      throw new Error("Canvas is too large to export completely");
    }
    const params = new URLSearchParams({
      canvasId,
      limit: String(EXPORT_PAGE_LIMIT),
    });
    if (cursor) params.set("cursor", cursor);
    const response = await apiFetch(`/api/v1/canvas-items?${params}`);
    const body = (await response.json()) as CanvasItemListPage;
    if (!Array.isArray(body.items)) {
      throw new Error("Unexpected canvas item listing response");
    }
    fetched.push(...body.items);
    if (!body.hasMore) break;
    if (!body.nextCursor || body.items.length === 0) {
      throw new Error("Canvas item listing ended before the last page");
    }
    cursor = body.nextCursor;
  }

  const live = new Map(liveItems.map((item) => [item.id, item]));
  const merged = fetched.map((item) => live.get(item.id) ?? item);
  const seen = new Set(merged.map((item) => item.id));
  for (const item of liveItems) {
    if (!seen.has(item.id)) merged.push(item);
  }
  return merged;
}

/**
 * Export canvas to JSON string
 */
export async function exportToJSON(
  canvasId: string,
  name: string,
  items: CanvasItem[],
): Promise<string> {
  const exportData = {
    version: 1,
    canvasId,
    name,
    exportedAt: new Date().toISOString(),
    items: items.map((item) => ({
      ...item,
      // Strip server-only fields if necessary
    })),
  };
  return JSON.stringify(exportData, null, 2);
}

/**
 * Export canvas to Markdown
 */
export async function exportToMarkdown(
  canvasId: string,
  name: string,
  items: CanvasItem[],
): Promise<string> {
  let md = `# ${name}\n\n`;

  // Sort items by position Y then X to roughly follow visual flow
  const sortedItems = [...items].sort((a, b) => {
    if (Math.abs(a.positionY - b.positionY) > 50) {
      return a.positionY - b.positionY;
    }
    return a.positionX - b.positionX;
  });

  for (const item of sortedItems) {
    switch (item.type) {
      case ItemType.NOTE:
      case ItemType.TEXT:
        if (isNoteContent(item.content) || isTextContent(item.content)) {
          const textContent = item.content as NoteContent | TextContent;
          md += `${"plainText" in textContent && textContent.plainText ? textContent.plainText : textContent.text || ""}\n\n`;
        }
        break;
      case ItemType.BOOKMARK:
        if (isBookmarkContent(item.content)) {
          const bookmarkContent = item.content as BookmarkContent;
          md += `[${bookmarkContent.title || bookmarkContent.url}](${bookmarkContent.url})\n\n`;
        }
        break;
      case ItemType.IMAGE:
        if (isImageContent(item.content)) {
          const imageContent = item.content as ImageContent;
          md += `![${imageContent.alt || "Image"}](${imageContent.url})\n\n`;
        }
        break;
      // Add other types as needed
    }
  }

  return md;
}

/** Konva node name for layers left out of raster exports (grid, ...). */
export const EXPORT_EXCLUDE_NAME = "export-exclude";

export interface ExportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** World-space box around every item, or null for an empty board. */
export function computeItemsBounds(
  items: ReadonlyArray<
    Pick<CanvasItem, "positionX" | "positionY" | "width" | "height">
  >,
  padding: number,
): ExportBounds | null {
  if (items.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of items) {
    minX = Math.min(minX, item.positionX);
    minY = Math.min(minY, item.positionY);
    maxX = Math.max(maxX, item.positionX + item.width);
    maxY = Math.max(maxY, item.positionY + item.height);
  }
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}

/** Browsers refuse canvases much larger than this on a side. */
const MAX_EXPORT_CANVAS_SIDE = 8192;

interface ExportNode {
  visible(): boolean;
  hide(): void;
  show(): void;
}

/** The parts of a Konva Stage the capture uses. */
export interface CapturableStage {
  x(): number;
  y(): number;
  scaleX(): number;
  scaleY(): number;
  position(position: { x: number; y: number }): unknown;
  scale(scale: { x: number; y: number }): unknown;
  find(selector: string): ArrayLike<ExportNode>;
  toDataURL(config: {
    x: number;
    y: number;
    width: number;
    height: number;
    pixelRatio: number;
  }): string;
  batchDraw(): unknown;
}

/**
 * Capture a world-space region of the stage as a PNG data URL. The board's
 * pan and zoom are neutralized and nodes named `exclude` hidden for the
 * capture only; both are restored even if it throws.
 */
export function captureStageRegion(
  stage: CapturableStage,
  bounds: ExportBounds,
  options: { pixelRatio: number; exclude: string },
): string {
  const view = {
    x: stage.x(),
    y: stage.y(),
    scaleX: stage.scaleX(),
    scaleY: stage.scaleY(),
  };
  const hidden = Array.from(stage.find(`.${options.exclude}`)).filter((node) =>
    node.visible(),
  );
  const pixelRatio = Math.min(
    options.pixelRatio,
    MAX_EXPORT_CANVAS_SIDE / Math.max(bounds.width, bounds.height, 1),
  );
  try {
    stage.position({ x: 0, y: 0 });
    stage.scale({ x: 1, y: 1 });
    for (const node of hidden) node.hide();
    return stage.toDataURL({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      pixelRatio,
    });
  } finally {
    for (const node of hidden) node.show();
    stage.position({ x: view.x, y: view.y });
    stage.scale({ x: view.scaleX, y: view.scaleY });
    stage.batchDraw();
  }
}

/**
 * Lets the board take part in a raster export: `prepare` renders every item
 * of the canvas (not just the culled viewport), unselected, and resolves
 * once that has committed; `restore` puts the board back as it was.
 */
export interface BoardExportCapture {
  prepare(): Promise<{ items: CanvasItem[]; restore: () => void }>;
}

/** A slot the mounted board fills with its capture; empty without a board. */
export const BoardExportCaptureContext = createContext<{
  current: BoardExportCapture | null;
}>({ current: null });

/**
 * Load the pictures of image items into the browser cache, so items the
 * board mounts only for a capture paint their picture, not a placeholder.
 * A picture that fails or takes longer than `timeoutMs` is skipped.
 */
export async function preloadItemImages(
  items: ReadonlyArray<Pick<CanvasItem, "type" | "content">>,
  timeoutMs = 5000,
): Promise<void> {
  const sources = new Set<string>();
  for (const item of items) {
    if (item.type !== ItemType.IMAGE || !isImageContent(item.content)) continue;
    const src = toImageProxyUrl((item.content as ImageContent).url);
    if (src) sources.add(src);
  }
  if (sources.size === 0) return;
  const loads = Array.from(
    sources,
    (src) =>
      new Promise<void>((resolve) => {
        const img = new window.Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = src;
      }),
  );
  await Promise.race([
    Promise.all(loads),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/**
 * Export a captured board image (see captureStageRegion) to PDF.
 */
export async function exportToPDF(
  name: string,
  dataUrl: string,
): Promise<void> {
  // Dynamic import to reduce bundle size
  const { jsPDF } = await import("jspdf");

  const pdf = new jsPDF({
    orientation: "landscape",
  });

  const imgProps = pdf.getImageProperties(dataUrl);
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  // Fit both dimensions so a tall (portrait) snapshot is not cut off below
  // the page; a wide one still fills the page width.
  const scale = Math.min(
    pageWidth / imgProps.width,
    pageHeight / imgProps.height,
  );
  const drawWidth = imgProps.width * scale;
  const drawHeight = imgProps.height * scale;

  pdf.addImage(
    dataUrl,
    "PNG",
    (pageWidth - drawWidth) / 2,
    (pageHeight - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  pdf.save(`${name}.pdf`);
}
