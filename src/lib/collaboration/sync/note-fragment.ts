/**
 * IMP-042 — note text as a Yjs XML fragment.
 *
 * TipTap's collaboration extension (y-prosemirror) stores a note as a
 * `Y.XmlFragment`: one `Y.XmlElement` per node (attributes are the node's
 * non-null attrs) and one `Y.XmlText` per run of text, whose formatting
 * attributes are the marks. `readNoteFragment` turns that structure back into
 * Memoria's versioned note format, refusing anything the note validator would
 * not accept, so the sync server never trusts a client-built fragment.
 * `writeNoteFragment` goes the other way for row → document reconciliation.
 *
 * @module lib/collaboration/sync/note-fragment
 */

import * as Y from "yjs";
import { prosemirrorToYXmlFragment } from "@tiptap/y-tiptap";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { sanitizeUrl } from "@/lib/sanitization";
import {
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_DEPTH,
  MAX_DOCUMENT_NODES,
  normalizeNoteContent,
  type TiptapMark,
  type TiptapNode,
  type VersionedNoteContent,
} from "@/lib/rich-text/note-format";
import { collaborativeNoteSchema } from "./note-schema";

export class NoteFragmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoteFragmentError";
  }
}

function fail(message: string): never {
  throw new NoteFragmentError(message);
}

const MARK_ORDER: TiptapMark["type"][] = [
  "link",
  "bold",
  "italic",
  "strike",
  "code",
];
const PLAIN_BLOCKS = new Set([
  "paragraph",
  "bulletList",
  "listItem",
  "blockquote",
]);
const ORDERED_LIST_TYPES = new Set(["1", "a", "A", "i", "I"]);
const CODE_LANGUAGE = /^[A-Za-z0-9_+#.-]{1,40}$/;
const LINK_REL = /^[a-z ]{0,100}$/;

interface ReadBudget {
  nodes: number;
  characters: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Y.AbstractType)
  );
}

function onlyKeys(value: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail("Unsupported rich-text attribute.");
  }
}

function countNode(budget: ReadBudget): void {
  budget.nodes += 1;
  if (budget.nodes > MAX_DOCUMENT_NODES)
    fail("Rich-text document has too many nodes.");
}

function readLinkMark(value: unknown): TiptapMark {
  if (!isPlainObject(value)) return fail("Invalid link mark.");
  onlyKeys(value, ["href", "target", "rel", "class", "title"]);
  if (typeof value.href !== "string") return fail("Invalid link mark.");
  const href = sanitizeUrl(value.href);
  if (!href) return fail("Unsafe rich-text link.");
  if (value.target != null && value.target !== "_blank")
    fail("Invalid link target.");
  if (
    value.rel != null &&
    (typeof value.rel !== "string" || !LINK_REL.test(value.rel))
  )
    fail("Invalid link rel.");
  if (value.class != null) fail("Invalid link class.");
  if (
    value.title != null &&
    (typeof value.title !== "string" || value.title.length > 500)
  )
    fail("Invalid link title.");
  return { type: "link", attrs: { href } };
}

function readMarks(attributes: Record<string, unknown> | undefined) {
  if (!attributes) return [];
  const marks: TiptapMark[] = [];
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined) continue;
    if (name === "link") {
      marks.push(readLinkMark(value));
      continue;
    }
    if (!MARK_ORDER.includes(name as TiptapMark["type"]))
      fail("Unsupported rich-text mark.");
    // y-prosemirror stores attribute-less marks as an empty object.
    if (value !== true && !(isPlainObject(value) && !Object.keys(value).length))
      fail("Unexpected rich-text mark attributes.");
    marks.push({ type: name as TiptapMark["type"] });
  }
  return marks.sort(
    (left, right) =>
      MARK_ORDER.indexOf(left.type) - MARK_ORDER.indexOf(right.type),
  );
}

function readText(text: Y.XmlText, budget: ReadBudget): TiptapNode[] {
  const nodes: TiptapNode[] = [];
  for (const op of text.toDelta() as Array<{
    insert: unknown;
    attributes?: Record<string, unknown>;
  }>) {
    if (typeof op.insert !== "string")
      fail("Rich-text text may only contain characters.");
    if (!op.insert) continue;
    budget.characters += op.insert.length;
    if (budget.characters > MAX_DOCUMENT_BYTES)
      fail("Rich-text document is too large.");
    countNode(budget);
    const marks = readMarks(op.attributes);
    nodes.push({
      type: "text",
      text: op.insert,
      ...(marks.length ? { marks } : {}),
    });
  }
  return nodes;
}

function readAttributes(element: Y.XmlElement): Record<string, unknown> {
  const attributes = element.getAttributes() as Record<string, unknown>;
  for (const value of Object.values(attributes)) {
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    )
      fail("Unsupported rich-text attribute value.");
  }
  return attributes;
}

function readElement(
  element: Y.XmlElement,
  depth: number,
  budget: ReadBudget,
): TiptapNode {
  if (depth > MAX_DOCUMENT_DEPTH)
    fail("Rich-text document is too deeply nested.");
  countNode(budget);
  const type = element.nodeName;
  const attributes = readAttributes(element);

  if (type === "hardBreak") {
    onlyKeys(attributes, []);
    if (element.length > 0) fail("Invalid hard break.");
    return { type: "hardBreak" };
  }

  let attrs: Record<string, unknown> | undefined;
  if (type === "heading") {
    onlyKeys(attributes, ["level"]);
    if (![1, 2, 3].includes(attributes.level as number))
      fail("Unsupported heading level.");
    attrs = { level: attributes.level };
  } else if (type === "orderedList") {
    onlyKeys(attributes, ["start", "type"]);
    const start = attributes.start;
    if (
      start != null &&
      !(Number.isSafeInteger(start) && (start as number) >= 0)
    )
      fail("Invalid ordered list start.");
    if (
      attributes.type != null &&
      !ORDERED_LIST_TYPES.has(attributes.type as string)
    )
      fail("Invalid ordered list type.");
  } else if (type === "codeBlock") {
    onlyKeys(attributes, ["language"]);
    const language = attributes.language;
    if (
      language != null &&
      (typeof language !== "string" || !CODE_LANGUAGE.test(language))
    )
      fail("Invalid code block language.");
  } else if (PLAIN_BLOCKS.has(type)) {
    onlyKeys(attributes, []);
  } else {
    fail("Unsupported rich-text node.");
  }

  return {
    type,
    ...(attrs ? { attrs } : {}),
    content: readChildren(element, depth, budget),
  };
}

function readChildren(
  parent: Y.XmlFragment,
  depth: number,
  budget: ReadBudget,
): TiptapNode[] {
  const nodes: TiptapNode[] = [];
  for (const child of parent.toArray() as unknown[]) {
    if (child instanceof Y.XmlText) {
      nodes.push(...readText(child, budget));
    } else if (child instanceof Y.XmlElement) {
      nodes.push(readElement(child, depth + 1, budget));
    } else {
      fail("Unsupported rich-text content.");
    }
  }
  return nodes;
}

/**
 * Validate a note fragment and return it in the versioned note format. Throws
 * `NoteFragmentError` (or the note validator's error) for anything outside it.
 */
export function readNoteFragment(
  fragment: Y.XmlFragment,
): VersionedNoteContent {
  if (fragment instanceof Y.XmlElement)
    fail("Note text must be an XML fragment.");
  const document: TiptapNode = {
    type: "doc",
    content: readChildren(fragment, 0, { nodes: 0, characters: 0 }),
  };
  try {
    return normalizeNoteContent(
      { formatVersion: 1, document },
      { allowEmpty: true },
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Invalid note text.");
  }
}

/** Marks in a stable order, so two encodings of the same text compare equal. */
export function canonicalNoteDocument(document: TiptapNode): TiptapNode {
  return {
    type: document.type,
    ...(document.attrs ? { attrs: document.attrs } : {}),
    ...(document.text !== undefined ? { text: document.text } : {}),
    ...(document.marks?.length
      ? {
          marks: [...document.marks].sort(
            (left, right) =>
              MARK_ORDER.indexOf(left.type) - MARK_ORDER.indexOf(right.type),
          ),
        }
      : {}),
    ...(document.content
      ? { content: document.content.map(canonicalNoteDocument) }
      : {}),
  };
}

/**
 * The note document a stored `CanvasItem.content` represents. Legacy and empty
 * notes fall back to an empty paragraph rather than failing reconciliation.
 */
export function noteDocumentFromContent(content: unknown): TiptapNode {
  try {
    return canonicalNoteDocument(
      normalizeNoteContent(content, { allowEmpty: true }).document,
    );
  } catch {
    return { type: "doc", content: [{ type: "paragraph", content: [] }] };
  }
}

const LIST_TYPES = new Set(["bulletList", "orderedList"]);
const TEXT_BLOCK_TYPES = new Set(["paragraph", "heading", "codeBlock"]);

function emptyParagraph(): TiptapNode {
  return { type: "paragraph", content: [] };
}

/**
 * Unambiguous structural fixes for shapes the note format admits but
 * TipTap's schema rejects: list items outside a list are wrapped in a bullet
 * list, lists without items are dropped, an empty blockquote gets an empty
 * paragraph, and a list item that does not start with a paragraph gets an
 * empty one first. Text and its order are untouched.
 */
function repairChildren(nodes: TiptapNode[], parentType: string): TiptapNode[] {
  const repaired: TiptapNode[] = [];
  let looseItems: TiptapNode[] = [];
  const flushLooseItems = () => {
    if (looseItems.length) {
      repaired.push({ type: "bulletList", content: looseItems });
      looseItems = [];
    }
  };
  for (const node of nodes) {
    const fixed = repairNode(node);
    if (!fixed) continue;
    if (fixed.type === "listItem" && !LIST_TYPES.has(parentType)) {
      looseItems.push(fixed);
      continue;
    }
    flushLooseItems();
    repaired.push(fixed);
  }
  flushLooseItems();
  return repaired;
}

function repairNode(node: TiptapNode): TiptapNode | null {
  if (!node.content) return node;
  const content = repairChildren(node.content, node.type);
  if (LIST_TYPES.has(node.type) && content.length === 0) return null;
  if (node.type === "blockquote" && content.length === 0) {
    return { ...node, content: [emptyParagraph()] };
  }
  if (node.type === "listItem" && content[0]?.type !== "paragraph") {
    return { ...node, content: [emptyParagraph(), ...content] };
  }
  return { ...node, content };
}

function repairNoteDocument(document: TiptapNode): TiptapNode {
  const content = repairChildren(document.content ?? [], document.type);
  return {
    ...document,
    content: content.length ? content : [emptyParagraph()],
  };
}

/** Paragraphs, headings and code blocks of a document, in order. */
function textBlocks(document: TiptapNode): TiptapNode[] {
  const blocks: TiptapNode[] = [];
  const visit = (node: TiptapNode) => {
    if (TEXT_BLOCK_TYPES.has(node.type)) {
      blocks.push(node);
      return;
    }
    node.content?.forEach(visit);
  };
  visit(document);
  return blocks;
}

function blockText(node: TiptapNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return " ";
  return (node.content ?? []).map(blockText).join("");
}

function checkedNode(json: TiptapNode): ProseMirrorNode {
  const node = collaborativeNoteSchema().nodeFromJSON(json);
  node.check();
  return node;
}

/**
 * Last resort when even the repaired document is rejected: one paragraph per
 * text block, keeping text marks and hard breaks, and failing that one
 * plain-text paragraph per block. Words from separate blocks are never
 * joined.
 */
function blockParagraphsNode(document: TiptapNode): ProseMirrorNode {
  const blocks = textBlocks(document);
  try {
    const content = blocks.map((block) => ({
      type: "paragraph",
      content: (block.content ?? []).filter(
        (child) =>
          (child.type === "text" && child.text) || child.type === "hardBreak",
      ),
    }));
    return checkedNode({
      type: "doc",
      content: content.length ? content : [emptyParagraph()],
    });
  } catch {
    const content = blocks.map((block) => {
      const text = blockText(block);
      return {
        type: "paragraph",
        content: text ? [{ type: "text", text }] : [],
      };
    });
    return collaborativeNoteSchema().nodeFromJSON({
      type: "doc",
      content: content.length ? content : [emptyParagraph()],
    });
  }
}

/**
 * Make `fragment` represent `document`, reusing unchanged nodes so concurrent
 * edits elsewhere in the note survive. Must run inside a document transaction
 * when the fragment is integrated.
 */
export function writeNoteFragment(
  fragment: Y.XmlFragment,
  document: TiptapNode,
): void {
  let node: ProseMirrorNode;
  try {
    node = checkedNode(document);
  } catch {
    // The stored format admits a few shapes TipTap's schema does not (an
    // empty list, a top-level list item, a list item that does not start
    // with a paragraph, an empty blockquote). Repair the structure first;
    // if that is still rejected, keep one paragraph per text block so the
    // words of separate blocks never run together.
    try {
      node = checkedNode(repairNoteDocument(document));
    } catch {
      node = blockParagraphsNode(document);
    }
  }
  prosemirrorToYXmlFragment(node, fragment);
}
