import type { TiptapNode } from "@/lib/rich-text/note-format";

/**
 * Turns `editor.getJSON()` (ProseMirror's toJSON) into the canonical shape
 * normalizeNoteContent accepts. ProseMirror omits `content` on empty nodes
 * and writes every attribute default (link target/rel/class/title, ordered
 * list start/type, code block language). Like the collaborative path
 * (readElement/readLinkMark in note-fragment.ts), only heading `level` and
 * link `href` survive. Unknown node and mark types pass through unchanged so
 * the validator still rejects them.
 */
export function toCanonicalNoteDocument(json: unknown): TiptapNode {
  return canonicalNode(json) as TiptapNode;
}

const KNOWN_BLOCKS = new Set([
  "doc",
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
]);
const PLAIN_MARKS = new Set(["bold", "italic", "strike", "code"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalMark(value: unknown): unknown {
  if (!isObject(value)) return value;
  if (value.type === "link") {
    const attrs = isObject(value.attrs) ? value.attrs : {};
    return { type: "link", attrs: { href: attrs.href } };
  }
  if (typeof value.type === "string" && PLAIN_MARKS.has(value.type)) {
    const attrs = value.attrs;
    if (
      attrs === null ||
      attrs === undefined ||
      (isObject(attrs) && Object.keys(attrs).length === 0)
    ) {
      return { type: value.type };
    }
  }
  return value;
}

function canonicalNode(value: unknown): unknown {
  if (!isObject(value)) return value;
  const type = value.type;

  if (type === "text") {
    return Array.isArray(value.marks)
      ? { ...value, marks: value.marks.map(canonicalMark) }
      : value;
  }
  if (type === "hardBreak") {
    const node = { ...value };
    delete node.attrs;
    return node;
  }
  if (typeof type !== "string" || !KNOWN_BLOCKS.has(type)) return value;

  const node: Record<string, unknown> = { ...value };
  if (type === "heading") {
    const attrs = isObject(value.attrs) ? value.attrs : {};
    node.attrs = { level: attrs.level };
  } else {
    delete node.attrs;
  }
  node.content = Array.isArray(value.content)
    ? value.content.map(canonicalNode)
    : value.content === undefined
      ? []
      : value.content;
  return node;
}
