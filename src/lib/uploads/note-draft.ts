/**
 * Turns a model's plain-text write-up into a titled note document (IMP-071).
 * Pure: no I/O, so the formatting is unit-tested on its own.
 */

import { MAX_NOTE_TEXT_LENGTH } from "@/lib/constants";
import type { TiptapNode } from "@/lib/rich-text/note-format";

export interface NoteDraft {
  title: string;
  body: string;
}

const MAX_TITLE_LENGTH = 80;
// Leaves room for the title and the link back to the original.
const MAX_BODY_LENGTH = MAX_NOTE_TEXT_LENGTH - 400;
const MAX_BODY_LINES = 300;
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;
const ORDERED = /^\s*\d+[.)]\s+/;

function cleanTitle(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/^\s*title\s*:\s*/i, "")
    .replace(/^[*_"'`\s]+|[*_"'`\s]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, MAX_TITLE_LENGTH)
    .trim();
}

function cleanInline(line: string): string {
  // The note stores plain text; drop markdown emphasis the model may add.
  return line
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/\s+$/g, "");
}

/** First non-empty line is the title; the rest is the body. */
export function parseNoteDraft(text: string, fallbackTitle: string): NoteDraft {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && !lines[0]!.trim()) lines.shift();
  const title = cleanTitle(lines.shift() ?? "") || fallbackTitle;
  const body = lines
    .join("\n")
    .trim()
    .replace(/^\s*(body|note)\s*:\s*/i, "")
    .slice(0, MAX_BODY_LENGTH);
  return { title, body };
}

function textNode(text: string): TiptapNode {
  return { type: "text", text };
}

function paragraph(lines: string[]): TiptapNode {
  const content: TiptapNode[] = [];
  lines.forEach((line, index) => {
    if (index > 0) content.push({ type: "hardBreak" });
    content.push(textNode(line));
  });
  return { type: "paragraph", content };
}

function list(lines: string[]): TiptapNode {
  const ordered = lines.every((line) => ORDERED.test(line));
  return {
    type: ordered ? "orderedList" : "bulletList",
    content: lines.map((line) => ({
      type: "listItem",
      content: [paragraph([line.replace(BULLET, "")])],
    })),
  };
}

function bodyBlocks(body: string): TiptapNode[] {
  const blocks: TiptapNode[] = [];
  let run: string[] = [];
  let runIsList = false;
  const flush = () => {
    if (run.length) blocks.push(runIsList ? list(run) : paragraph(run));
    run = [];
  };
  const lines = body.split("\n").map(cleanInline).slice(0, MAX_BODY_LINES);
  for (const line of lines) {
    if (!line.trim()) {
      flush();
      continue;
    }
    const isList = BULLET.test(line) && line.replace(BULLET, "").trim() !== "";
    if (run.length && isList !== runIsList) flush();
    runIsList = isList;
    run.push(line.trim());
  }
  flush();
  return blocks;
}

/**
 * The stored note: a heading, the cleaned body, then a line that links to the
 * kept original through its private upload URL.
 */
export function buildNoteDocument(input: {
  draft: NoteDraft;
  originalUrl: string;
  originalLabel: string;
  emptyBody: string;
}): { formatVersion: 1; document: TiptapNode } {
  const blocks = bodyBlocks(input.draft.body);
  return {
    formatVersion: 1,
    document: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [textNode(input.draft.title)],
        },
        ...(blocks.length ? blocks : [paragraph([input.emptyBody])]),
        {
          type: "paragraph",
          content: [
            textNode("Original: "),
            {
              type: "text",
              text: input.originalLabel,
              marks: [{ type: "link", attrs: { href: input.originalUrl } }],
            },
          ],
        },
      ],
    },
  };
}
