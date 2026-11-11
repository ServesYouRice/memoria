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
  const document = legacyHtmlToDocument(sanitizeNoteHtml(value.text));
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

/** The parts of a parsed DOM node the legacy converter reads. */
type LegacyDomNode = {
  type: string;
  name?: string;
  data?: string;
  attribs?: Record<string, string>;
  children?: LegacyDomNode[];
};

const LEGACY_MARK_TAGS: Record<string, TiptapMark["type"]> = {
  strong: "bold",
  b: "bold",
  em: "italic",
  i: "italic",
  s: "strike",
  code: "code",
};
const LEGACY_BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "pre",
  "blockquote",
]);

function legacyText(node: LegacyDomNode): string {
  if (node.type === "text") return node.data || "";
  if (node.type === "tag" && node.name === "br") return "\n";
  return (node.children || []).map(legacyText).join("");
}

function legacyInline(
  nodes: LegacyDomNode[],
  marks: TiptapMark[],
  out: TiptapNode[],
) {
  for (const node of nodes) {
    if (node.type === "text") {
      // HTML whitespace only: a decoded &nbsp; (U+00A0) stays as typed.
      const text = (node.data || "").replace(/[ \t\n\r\f]+/g, " ");
      if (text)
        out.push({
          type: "text",
          text,
          ...(marks.length ? { marks: [...marks] } : {}),
        });
      continue;
    }
    if (node.type !== "tag") continue;
    const name = node.name?.toLowerCase();
    if (name === "br") {
      out.push({ type: "hardBreak" });
      continue;
    }
    let childMarks = marks;
    const markType = name ? LEGACY_MARK_TAGS[name] : undefined;
    if (markType && !marks.some((mark) => mark.type === markType)) {
      childMarks = [...marks, { type: markType }];
    } else if (name === "a" && !marks.some((mark) => mark.type === "link")) {
      const href = sanitizeUrl(node.attribs?.href || "");
      if (href) childMarks = [...marks, { type: "link", attrs: { href } }];
    }
    legacyInline(node.children || [], childMarks, out);
  }
}

/** Trims the edges of a line of inline nodes and drops empty text nodes. */
function tidyInline(nodes: TiptapNode[]): TiptapNode[] {
  const trimmed = nodes.map((node, index) => {
    if (node.type !== "text") return node;
    let text = node.text || "";
    const previous = nodes[index - 1];
    const next = nodes[index + 1];
    if (!previous || previous.type === "hardBreak") text = text.trimStart();
    if (!next || next.type === "hardBreak") text = text.trimEnd();
    return { ...node, text };
  });
  return trimmed.filter((node) => node.type !== "text" || node.text);
}

function legacyBlocks(nodes: LegacyDomNode[]): TiptapNode[] {
  const blocks: TiptapNode[] = [];
  let run: LegacyDomNode[] = [];
  const flush = () => {
    const content: TiptapNode[] = [];
    legacyInline(run, [], content);
    const tidy = tidyInline(content);
    if (tidy.some((node) => node.type === "text"))
      blocks.push({ type: "paragraph", content: tidy });
    run = [];
  };

  for (const node of nodes) {
    const name = node.type === "tag" ? node.name?.toLowerCase() : undefined;
    if (!name || !LEGACY_BLOCK_TAGS.has(name)) {
      run.push(node);
      continue;
    }
    flush();
    const children = node.children || [];
    if (name === "p") {
      const content: TiptapNode[] = [];
      legacyInline(children, [], content);
      blocks.push({ type: "paragraph", content: tidyInline(content) });
    } else if (name === "h1" || name === "h2" || name === "h3") {
      const content: TiptapNode[] = [];
      legacyInline(children, [], content);
      blocks.push({
        type: "heading",
        attrs: { level: Number(name[1]) },
        content: tidyInline(content),
      });
    } else if (name === "pre") {
      const text = legacyText(node);
      blocks.push({
        type: "codeBlock",
        content: text ? [{ type: "text", text }] : [],
      });
    } else if (name === "ul" || name === "ol") {
      const items = children.filter(
        (child) => child.type === "tag" || (child.data || "").trim(),
      );
      blocks.push({
        type: name === "ul" ? "bulletList" : "orderedList",
        content: items.map((child) =>
          legacyListItem(
            child.type === "tag" && child.name?.toLowerCase() === "li"
              ? child.children || []
              : [child],
          ),
        ),
      });
    } else if (name === "li") {
      blocks.push({
        type: "bulletList",
        content: [legacyListItem(children)],
      });
    } else {
      const content = legacyBlocks(children);
      blocks.push({
        type: "blockquote",
        content: content.length
          ? content
          : [{ type: "paragraph", content: [] }],
      });
    }
  }
  flush();
  return blocks;
}

function legacyListItem(children: LegacyDomNode[]): TiptapNode {
  const content = legacyBlocks(children);
  if (content[0]?.type !== "paragraph")
    content.unshift({ type: "paragraph", content: [] });
  return { type: "listItem", content };
}

/** Plain text without markup: blank lines split paragraphs, lines break. */
function plainTextToDocument(text: string): TiptapNode {
  const content = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => {
      const inline: TiptapNode[] = [];
      paragraph.split("\n").forEach((line, index) => {
        if (index > 0) inline.push({ type: "hardBreak" });
        if (line.trim()) inline.push({ type: "text", text: line.trim() });
      });
      return { type: "paragraph", content: inline };
    });
  return { type: "doc", content };
}

/**
 * Turns sanitized legacy note HTML into a rich-text document that keeps its
 * blocks and marks. Text comes from DOM text nodes, so entities are decoded.
 */
function legacyHtmlToDocument(safeHtml: string): TiptapNode {
  const $ = load(safeHtml, null, false);
  const nodes = $.root().contents().toArray() as unknown as LegacyDomNode[];
  const raw = nodes.some((node) => node.type === "tag")
    ? { type: "doc", content: legacyBlocks(nodes) }
    : plainTextToDocument(legacyText({ type: "root", children: nodes }));
  try {
    return validateNode(raw, 0, { value: 0 });
  } catch {
    // Too deep or too many nodes: keep the text, one paragraph per line, or
    // as a single paragraph when even that has too many nodes.
    const text = extractText(raw);
    try {
      return validateNode(plainTextToDocument(text.replace(/\n/g, "\n\n")), 0, {
        value: 0,
      });
    } catch {
      const flat = text.replace(/\s+/g, " ").trim();
      return {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: flat ? [{ type: "text", text: flat }] : [],
          },
        ],
      };
    }
  }
}
