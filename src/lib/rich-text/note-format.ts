import { load } from "cheerio";
import { sanitizeNoteHtml, sanitizeUrl } from "@/lib/sanitization";
import { MAX_NOTE_TEXT_LENGTH } from "@/lib/constants";

export const MAX_DOCUMENT_BYTES = 50_000;
export const MAX_DOCUMENT_DEPTH = 12;
export const MAX_DOCUMENT_NODES = 1_000;
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

export interface NormalizeNoteOptions {
  /**
   * Accept a document without text. Collaborative editing (IMP-042) passes
   * through empty states while people type, so the sync server projects them;
   * the HTTP API keeps rejecting empty notes.
   */
  allowEmpty?: boolean;
}

export function normalizeNoteContent(
  input: unknown,
  options: NormalizeNoteOptions = {},
): VersionedNoteContent {
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
    if (!plainText && !options.allowEmpty)
      return fail("Note text cannot be empty.");
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
  let document = legacyHtmlToDocument(safeHtml);
  const plainText = extractText(document).trim();
  if (!plainText) return fail("Note text cannot be empty.");
  if (plainText.length > MAX_NOTE_TEXT_LENGTH)
    return fail("Note text is too long.");
  try {
    document = validateNode(document, 0, { value: 0 });
  } catch {
    // Too many blocks for the document limits: keep the decoded text in one
    // paragraph rather than rejecting a note that was valid before.
    document = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: plainText }] },
      ],
    };
  }
  return { formatVersion: 1, document, plainText, text: safeHtml };
}

type LegacyHtmlNode = {
  type: string;
  name?: string;
  data?: string;
  children?: LegacyHtmlNode[];
};
const LEGACY_TEXT_BLOCKS = new Set(["p", "h1", "h2", "h3", "pre"]);
const LEGACY_CONTAINER_BLOCKS = new Set(["ul", "ol", "li", "blockquote"]);

/** Inline children of a block: cheerio text nodes hold decoded text. */
function legacyInline(
  node: LegacyHtmlNode,
  out: TiptapNode[],
  preformatted: boolean,
) {
  if (node.type === "text") {
    const text = preformatted
      ? node.data || ""
      : (node.data || "").replace(/[ \t\n\r\f]+/g, " ");
    const last = out[out.length - 1];
    if (last?.type === "text") last.text += text;
    else if (text) out.push({ type: "text", text });
    return;
  }
  if (node.type !== "tag") return;
  if (node.name === "br") {
    out.push({ type: "hardBreak" });
    return;
  }
  for (const child of node.children || [])
    legacyInline(child, out, preformatted || node.name === "pre");
}

function legacyParagraph(inline: TiptapNode[], preformatted: boolean) {
  const content: TiptapNode[] = [];
  for (const node of inline) {
    if (node.type !== "text" || !preformatted) {
      content.push(node.type === "text" ? { ...node } : node);
      continue;
    }
    // Keep preformatted line breaks as hard breaks.
    (node.text || "").split("\n").forEach((line, index) => {
      if (index > 0) content.push({ type: "hardBreak" });
      if (line) content.push({ type: "text", text: line });
    });
  }
  if (!preformatted) {
    const first = content[0];
    if (first?.type === "text") first.text = first.text!.replace(/^ +/, "");
    const last = content[content.length - 1];
    if (last?.type === "text") last.text = last.text!.replace(/ +$/, "");
  }
  return {
    type: "paragraph",
    content: content.filter((node) => node.type !== "text" || node.text),
  };
}

/**
 * Turn sanitized legacy HTML into one paragraph per source block (p, h1-h3,
 * pre, li, blockquote), with decoded text and hard breaks for <br>.
 */
function legacyHtmlToDocument(safeHtml: string): TiptapNode {
  const $ = load(`<div id="legacy-note-root">${safeHtml}</div>`, null, false);
  const root = $("#legacy-note-root").get(0) as unknown as LegacyHtmlNode;
  const blocks: TiptapNode[] = [];
  const walk = (nodes: LegacyHtmlNode[]) => {
    let run: TiptapNode[] = [];
    const flush = () => {
      const paragraph = legacyParagraph(run, false);
      if (paragraph.content.length) blocks.push(paragraph);
      run = [];
    };
    for (const node of nodes) {
      if (node.type === "tag" && LEGACY_TEXT_BLOCKS.has(node.name || "")) {
        flush();
        const inline: TiptapNode[] = [];
        for (const child of node.children || [])
          legacyInline(child, inline, node.name === "pre");
        blocks.push(legacyParagraph(inline, node.name === "pre"));
      } else if (
        node.type === "tag" &&
        LEGACY_CONTAINER_BLOCKS.has(node.name || "")
      ) {
        flush();
        walk(node.children || []);
      } else legacyInline(node, run, false);
    }
    flush();
  };
  walk(root?.children || []);
  return { type: "doc", content: blocks };
}
