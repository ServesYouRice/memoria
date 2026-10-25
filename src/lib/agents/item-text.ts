import { stripHtmlTags } from "@/lib/utils/html";

interface TextSourceItem {
  type: string;
  content: unknown;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

/** Title-like label an agent or a pile can show for one item. */
export function getItemTitle(item: TextSourceItem) {
  const content =
    item.content && typeof item.content === "object"
      ? (item.content as Record<string, unknown>)
      : {};

  if (item.type === "NOTE") {
    const text =
      readString(content, "plainText") ||
      stripHtmlTags(readString(content, "text"));
    return text.split("\n")[0]?.slice(0, 120) || "Note";
  }

  return (
    readString(content, "title") ||
    readString(content, "question") ||
    readString(content, "text").slice(0, 120) ||
    readString(content, "url") ||
    readString(content, "alt") ||
    item.type.toLowerCase()
  );
}

/** Plain text of an item for search, grouping and agent reads. */
export function getItemPlainText(item: TextSourceItem) {
  const content =
    item.content && typeof item.content === "object"
      ? (item.content as Record<string, unknown>)
      : {};

  switch (item.type) {
    case "NOTE":
      return (
        readString(content, "plainText") ||
        stripHtmlTags(readString(content, "text"))
      );
    case "BOOKMARK":
      return [
        readString(content, "title"),
        readString(content, "description"),
        readString(content, "url"),
      ]
        .filter(Boolean)
        .join("\n");
    case "IMAGE":
      return [readString(content, "alt"), readString(content, "filename")]
        .filter(Boolean)
        .join("\n");
    default:
      return [
        readString(content, "title"),
        readString(content, "text"),
        readString(content, "question"),
        readString(content, "description"),
        readString(content, "url"),
      ]
        .filter(Boolean)
        .join("\n");
  }
}

export function getItemUrl(item: TextSourceItem) {
  const content =
    item.content && typeof item.content === "object"
      ? (item.content as Record<string, unknown>)
      : {};
  const url = readString(content, "url");
  return url || null;
}
