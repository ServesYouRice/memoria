import {
  ItemType,
  isArrowContent,
  isBookmarkContent,
  isEmbedContent,
  isFrameContent,
  isImageContent,
  isNoteContent,
  isPollContent,
  isShapeContent,
  isTextContent,
  type CanvasItem,
} from "@/types/canvas";
import { stripHtmlTags } from "@/lib/utils/html";

/** Items whose main job is to preserve visual relationships around matches. */
export function isStructuralCanvasItem(item: CanvasItem): boolean {
  return [
    ItemType.ARROW,
    ItemType.DRAWING,
    ItemType.FRAME,
    ItemType.SHAPE,
  ].includes(item.type);
}

/** Searchable user-authored text without serializing arbitrary item JSON. */
export function canvasItemSearchText(item: CanvasItem): string {
  const content = item.content;
  const values: Array<string | undefined> = [...item.tags];

  if (isNoteContent(content)) {
    values.push(stripHtmlTags(content.plainText || content.text || ""));
  } else if (isBookmarkContent(content)) {
    values.push(
      content.title,
      content.description,
      content.siteName,
      content.url,
    );
  } else if (isImageContent(content)) {
    values.push(content.filename, content.alt);
  } else if (isTextContent(content)) {
    values.push(content.text);
  } else if (isFrameContent(content)) {
    values.push(content.title);
  } else if (isEmbedContent(content)) {
    values.push(content.url);
  } else if (isPollContent(content)) {
    values.push(
      content.question,
      ...content.options.map((option) => option.text),
    );
  } else if (isArrowContent(content)) {
    values.push(content.label);
  } else if (isShapeContent(content)) {
    values.push(content.shapeType);
  }

  return values.filter(Boolean).join("\n").toLocaleLowerCase();
}

export function canvasItemMatchesSearch(
  item: CanvasItem,
  query: string,
): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  return (
    normalized.length === 0 || canvasItemSearchText(item).includes(normalized)
  );
}
