import { stripHtml, sanitizeNoteHtml, sanitizeUrl } from "@/lib/sanitization";
import { MAX_NOTE_TEXT_LENGTH } from "@/lib/constants";

const MAX_DOCUMENT_BYTES = 50_000;
const MAX_DOCUMENT_DEPTH = 12;
const MAX_DOCUMENT_NODES = 1_000;
const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
]);
const INLINE_TYPES = new Set(["text", "hardBreak"]);
const MARK_TYPES = new Set(["bold", "italic", "strike", "code", "link"]);

export type TiptapMark = {
  type: "bold" | "italic" | "strike" | "code" | "link";
  attrs?: { href: string };
};
export type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: TiptapMark[];
  text?: string;
};
export type VersionedNoteContent = {
  formatVersion: 1;
  document: TiptapNode;
  plainText: string;
  text: string;
};

function fail(message: string): never {
  throw new Error(message);
}
function onlyKeys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    fail("Rich-text content contains unsupported fields.");
}

function validateMark(value: unknown): TiptapMark {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail("Invalid rich-text mark.");
  const mark = value as Record<string, unknown>;
  onlyKeys(mark, ["type", "attrs"]);
  if (typeof mark.type !== "string" || !MARK_TYPES.has(mark.type))
    return fail("Unsupported rich-text mark.");
  if (mark.type === "link") {
    const attrs = mark.attrs as Record<string, unknown> | undefined;
    if (!attrs || typeof attrs.href !== "string")
      return fail("Invalid link mark.");
    onlyKeys(attrs, ["href"]);
    const href = sanitizeUrl(attrs.href);
    if (!href) return fail("Unsafe rich-text link.");
    return { type: "link", attrs: { href } };
  }
  if (mark.attrs !== undefined)
    return fail("Unexpected rich-text mark attributes.");
  return { type: mark.type as TiptapMark["type"] };
}

function validateNode(
  value: unknown,
  depth: number,
  counter: { value: number },
): TiptapNode {
  if (depth > MAX_DOCUMENT_DEPTH)
    return fail("Rich-text document is too deeply nested.");
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail("Invalid rich-text node.");
  if (++counter.value > MAX_DOCUMENT_NODES)
    return fail("Rich-text document has too many nodes.");
  const node = value as Record<string, unknown>;
  onlyKeys(node, ["type", "attrs", "content", "marks", "text"]);
  if (typeof node.type !== "string")
    return fail("Rich-text node type is required.");
  if (node.type === "text") {
    if (typeof node.text !== "string" || !node.text)
      return fail("Text nodes cannot be empty.");
    if (node.attrs !== undefined || node.content !== undefined)
      return fail("Invalid text node.");
    const marks =
      node.marks === undefined
        ? undefined
        : Array.isArray(node.marks)
          ? node.marks.map(validateMark)
          : fail("Invalid text marks.");
    return {
      type: "text",
      text: node.text,
      ...(marks?.length ? { marks } : {}),
    };
  }
  if (node.type === "hardBreak") {
    if (
      node.attrs !== undefined ||
      node.content !== undefined ||
      node.text !== undefined ||
      node.marks !== undefined
    )
      return fail("Invalid hard break.");
    return { type: "hardBreak" };
  }
  if (node.type !== "doc" && !BLOCK_TYPES.has(node.type))
    return fail("Unsupported rich-text node.");
  if (node.text !== undefined || node.marks !== undefined)
    return fail("Invalid block node.");
  let attrs: Record<string, unknown> | undefined;
  if (node.type === "heading") {
    if (
      !node.attrs ||
      typeof node.attrs !== "object" ||
      Array.isArray(node.attrs)
    )
      return fail("Invalid heading.");
    const headingAttrs = node.attrs as Record<string, unknown>;
    onlyKeys(headingAttrs, ["level"]);
    if (![1, 2, 3].includes(headingAttrs.level as number))
      return fail("Unsupported heading level.");
    attrs = { level: headingAttrs.level };
  } else if (node.attrs !== undefined)
    return fail("Unexpected block attributes.");
  if (!Array.isArray(node.content))
    return fail("Block content must be an array.");
  const content = node.content.map((child) =>
    validateNode(child, depth + 1, counter),
  );
  if (
    node.type === "doc" &&
    content.some((child) => !BLOCK_TYPES.has(child.type))
  )
    return fail("Documents require block children.");
  if (
    ["paragraph", "heading"].includes(node.type) &&
    content.some((child) => !INLINE_TYPES.has(child.type))
  )
    return fail("Text blocks require inline children.");
  if (
    ["bulletList", "orderedList"].includes(node.type) &&
    content.some((child) => child.type !== "listItem")
  )
    return fail("Lists require list items.");
  if (
    node.type === "listItem" &&
    content.some((child) => !BLOCK_TYPES.has(child.type))
  )
    return fail("List items require block children.");
  if (
    node.type === "codeBlock" &&
    content.some((child) => child.type !== "text" || child.marks?.length)
  )
    return fail("Code blocks require unmarked text.");
  return { type: node.type, ...(attrs ? { attrs } : {}), content };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function renderNode(node: TiptapNode): string {
  if (node.type === "text") {
    let value = escapeHtml(node.text || "");
    for (const mark of node.marks || []) {
      const tags: Record<string, [string, string]> = {
        bold: ["<strong>", "</strong>"],
        italic: ["<em>", "</em>"],
        strike: ["<s>", "</s>"],
        code: ["<code>", "</code>"],
        link: [`<a href="${escapeHtml(mark.attrs?.href || "")}">`, "</a>"],
      };
      value = `${tags[mark.type][0]}${value}${tags[mark.type][1]}`;
    }
    return value;
  }
  if (node.type === "hardBreak") return "<br>";
  const inner = (node.content || []).map(renderNode).join("");
  const tag =
    node.type === "doc"
      ? null
      : node.type === "heading"
        ? `h${node.attrs?.level}`
        : (
            {
              paragraph: "p",
              bulletList: "ul",
              orderedList: "ol",
              listItem: "li",
              blockquote: "blockquote",
              codeBlock: "pre",
            } as Record<string, string>
          )[node.type];
  return tag ? `<${tag}>${inner}</${tag}>` : inner;
}
function extractText(node: TiptapNode): string {
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  const separator = [
    "doc",
    "bulletList",
    "orderedList",
    "listItem",
    "blockquote",
  ].includes(node.type)
    ? "\n"
    : "";
  return (node.content || []).map(extractText).join(separator);
}

export function normalizeNoteContent(input: unknown): VersionedNoteContent {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return fail("Invalid note content.");
  if (JSON.stringify(input).length > MAX_DOCUMENT_BYTES)
    return fail("Rich-text document is too large.");
  const value = input as Record<string, unknown>;
  if (value.formatVersion === 1) {
    const document = validateNode(value.document, 0, { value: 0 });
    if (document.type !== "doc")
      return fail("Rich-text document root must be doc.");
    const plainText = extractText(document).trim();
    if (!plainText) return fail("Note text cannot be empty.");
    if (plainText.length > MAX_NOTE_TEXT_LENGTH)
      return fail("Note text is too long.");
    return {
      formatVersion: 1,
      document,
      plainText,
      text: renderNode(document),
    };
  }
  if (typeof value.text !== "string")
    return fail("Invalid legacy note content.");
  const safeHtml = sanitizeNoteHtml(value.text);
  const plainText = stripHtml(safeHtml);
  if (!plainText) return fail("Note text cannot be empty.");
  if (plainText.length > MAX_NOTE_TEXT_LENGTH)
    return fail("Note text is too long.");
  return {
    formatVersion: 1,
    document: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: plainText }] },
      ],
    },
    plainText,
    text: safeHtml,
  };
}
