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

/**
 * Export to PDF (Basic implementation)
 */
export async function exportToPDF(
  name: string,
  stageRef: any, // Konva Stage reference
): Promise<void> {
  if (!stageRef) return;

  // Convert stage to dataURL
  const dataUrl = stageRef.toDataURL({ pixelRatio: 2 });

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
