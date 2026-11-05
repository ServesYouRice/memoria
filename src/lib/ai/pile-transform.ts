/**
 * IMP-069: turn a pile (frame) into a new note — a summary, a checklist or a
 * comparison table. The pile's items are only read; the result is a new NOTE
 * placed to the right of the frame and created the way the item API creates
 * one (canvas lock, capacity check, committed event for collaborators).
 */
import { z } from "zod";
import { ItemType, type Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireCanvasAccess } from "@/lib/api/auth";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import { assertCanvasItemCapacity } from "@/lib/policy/capacity";
import { recordCanvasItemEvent } from "@/lib/collaboration/committed-events";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import { ActivityType, logActivity } from "@/lib/activity";
import { MAX_ZINDEX } from "@/lib/constants";
import {
  notFoundError,
  ServiceUnavailableError,
  UnprocessableEntityError,
} from "@/lib/errors";
import { stripHtml } from "@/lib/sanitization";
import type { TiptapNode } from "@/lib/rich-text/note-format";
import {
  createCanvasItemSchema,
  parseCanvasItemContent,
} from "@/lib/validation/canvas-item";
import { runBudgetedAi, type AiUsageSnapshot } from "./budget";
import { AiProviderError } from "./errors";
import {
  AI_NOT_CONFIGURED_DETAIL,
  getAiAvailability,
} from "./provider-resolution";
import {
  AI_SUMMARY_CONTENT_BYTES,
  AI_SUMMARY_ITEM_LIMIT,
  generateText,
} from "./service";
import {
  PILE_TRANSFORM_KINDS,
  type PileTransformKind,
} from "./pile-transform-kinds";

export { PILE_TRANSFORM_KINDS, type PileTransformKind };

export const pileTransformSchema = z
  .object({
    canvasId: z.string().cuid(),
    frameId: z.string().cuid(),
    kind: z.enum(PILE_TRANSFORM_KINDS),
  })
  .strict();
export type PileTransformInput = z.infer<typeof pileTransformSchema>;

/** Item types whose text a pile transform reads. */
const READABLE_TYPES = [ItemType.NOTE, ItemType.TEXT, ItemType.BOOKMARK];

const NOTE_GAP = 40;
const NOTE_WIDTH = 360;
const MAX_SUMMARY_CHARS = 6_000;
const MAX_CHECKLIST_ITEMS = 40;
const MAX_CHECKLIST_ITEM_CHARS = 160;
const MAX_TABLE_COLUMNS = 6;
const MAX_TABLE_ROWS = 30;
const MAX_TABLE_CELL_CHARS = 32;

interface KindSpec {
  heading: string;
  instruction: string;
  system: string;
  maxTokens: number;
}

const KIND_SPECS: Record<PileTransformKind, KindSpec> = {
  summary: {
    heading: "Summary",
    instruction:
      "Summarize these items in one to three short paragraphs. Plain text only, no headings or bullet points.",
    system:
      "You are a succinct summarizer. Focus on the main themes and key information.",
    maxTokens: 500,
  },
  checklist: {
    heading: "Checklist",
    instruction: `Turn these items into a checklist of concrete actions. Write one action per line, at most ${MAX_CHECKLIST_ITEMS} lines, with no numbering, bullets or other text.`,
    system:
      "You turn notes into short, actionable checklists. Output only the checklist lines.",
    maxTokens: 600,
  },
  table: {
    heading: "Comparison",
    instruction: `Compare these items in a Markdown pipe table. The first row is the header; the first column names each item compared. Use at most ${MAX_TABLE_COLUMNS} columns and ${MAX_TABLE_ROWS} rows, keep cells short, and output only the table.`,
    system:
      "You build compact comparison tables. Output only a Markdown pipe table.",
    maxTokens: 900,
  },
};

interface PileItem {
  type: string;
  content: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function itemLine(item: PileItem): string {
  const content = asRecord(item.content);
  if (item.type === ItemType.NOTE) {
    const text = str(content.plainText) || stripHtml(str(content.text));
    return text ? `Note: ${text.replace(/\s+/g, " ")}` : "";
  }
  if (item.type === ItemType.TEXT) {
    const text = str(content.text);
    return text ? `Text: ${text.replace(/\s+/g, " ")}` : "";
  }
  if (item.type === ItemType.BOOKMARK) {
    const title = str(content.title) || str(content.url);
    const description = str(content.description);
    if (!title) return "";
    return description
      ? `Bookmark: ${title} (${description.replace(/\s+/g, " ")})`
      : `Bookmark: ${title}`;
  }
  return "";
}

/** Truncate to a UTF-8 byte budget without leaving a broken character. */
function truncateBytes(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) return value;
  return bytes.subarray(0, maxBytes).toString("utf8").replace(/�+$/, "");
}

/** The pile's text, capped by AI_SUMMARY_ITEM_LIMIT and AI_SUMMARY_CONTENT_BYTES. */
export function buildPileContent(items: PileItem[]): string {
  const content = items
    .slice(0, AI_SUMMARY_ITEM_LIMIT)
    .map(itemLine)
    .filter(Boolean)
    .join("\n");
  return truncateBytes(content, AI_SUMMARY_CONTENT_BYTES);
}

export function buildPilePrompt(
  kind: PileTransformKind,
  title: string,
  content: string,
): string {
  const label = title ? `the pile "${title}"` : "a pile";
  return `${KIND_SPECS[kind].instruction}\n\nItems in ${label}:\n\n${content}`;
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

function textNode(text: string): TiptapNode {
  return { type: "text", text };
}

function paragraph(text: string): TiptapNode {
  return { type: "paragraph", content: [textNode(text)] };
}

/** Removes Markdown list or checkbox markers a model may add anyway. */
function stripListMarker(line: string): string {
  return line
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, "")
    .replace(/^\s*(?:\[[ xX]?\]|[☐☑✓✔])\s*/, "")
    .trim();
}

function summaryBlocks(output: string): TiptapNode[] {
  const text = clip(output.trim(), MAX_SUMMARY_CHARS);
  return text
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .replace(/^#+\s*/gm, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .map(paragraph);
}

function checklistBlocks(output: string): TiptapNode[] {
  const lines = output
    .split("\n")
    .map(stripListMarker)
    .filter(Boolean)
    .slice(0, MAX_CHECKLIST_ITEMS);
  if (!lines.length) return [];
  return [
    {
      type: "bulletList",
      content: lines.map((line) => ({
        type: "listItem",
        content: [paragraph(`☐ ${clip(line, MAX_CHECKLIST_ITEM_CHARS)}`)],
      })),
    },
  ];
}

/** Parses a Markdown pipe table into bounded rows of cells. */
export function parsePipeTable(output: string): string[][] {
  const rows = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("|"))
    .filter((line) => !/^\|?[\s:|-]+\|?$/.test(line))
    .map((line) =>
      line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) =>
          clip(cell.replace(/\s+/g, " ").trim(), MAX_TABLE_CELL_CHARS),
        )
        .slice(0, MAX_TABLE_COLUMNS),
    )
    .filter((cells) => cells.some(Boolean))
    .slice(0, MAX_TABLE_ROWS + 1);
  const width = Math.max(0, ...rows.map((cells) => cells.length));
  return rows.map((cells) =>
    Array.from({ length: width }, (_, index) => cells[index] ?? ""),
  );
}

/**
 * Notes have no table node, so the table is a monospace grid in a code block:
 * it keeps its columns in the note, in exports and in plain-text search.
 */
function tableBlocks(output: string): TiptapNode[] {
  const rows = parsePipeTable(output);
  if (rows.length < 2 || rows[0].length < 2) return [];
  const widths = rows[0].map((_, column) =>
    Math.max(3, ...rows.map((cells) => cells[column].length)),
  );
  const line = (cells: string[]) =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column])).join(" | ")} |`;
  const separator = `|${widths.map((width) => "-".repeat(width + 2)).join("|")}|`;
  const text = [line(rows[0]), separator, ...rows.slice(1).map(line)].join(
    "\n",
  );
  return [{ type: "codeBlock", content: [textNode(text)] }];
}

const BLOCK_BUILDERS: Record<
  PileTransformKind,
  (output: string) => TiptapNode[]
> = {
  summary: summaryBlocks,
  checklist: checklistBlocks,
  table: tableBlocks,
};

/** Builds the note document; throws when the model returned nothing usable. */
export function buildPileNoteDocument(
  kind: PileTransformKind,
  title: string,
  output: string,
): TiptapNode {
  const body = BLOCK_BUILDERS[kind](output);
  if (!body.length) {
    throw new AiProviderError(
      kind === "table"
        ? "The AI did not return a table for this pile."
        : "The AI returned an empty result for this pile.",
    );
  }
  const heading = title
    ? `${KIND_SPECS[kind].heading}: ${clip(title, 120)}`
    : KIND_SPECS[kind].heading;
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 3 }, content: [textNode(heading)] },
      ...body,
    ],
  };
}

/** Rough note size so the result is readable without resizing. */
export function estimateNoteSize(document: TiptapNode): {
  width: number;
  height: number;
} {
  let lines = 0;
  let widest = 0;
  const visit = (node: TiptapNode) => {
    if (node.type === "codeBlock") {
      const text = node.content?.[0]?.text ?? "";
      const rows = text.split("\n");
      lines += rows.length;
      widest = Math.max(widest, ...rows.map((row) => row.length));
      return;
    }
    if (node.type === "paragraph" || node.type === "heading") {
      const length = (node.content ?? []).reduce(
        (sum, child) => sum + (child.text?.length ?? 0),
        0,
      );
      lines += Math.max(1, Math.ceil(length / 40));
      return;
    }
    node.content?.forEach(visit);
  };
  visit(document);
  const width = Math.min(960, Math.max(NOTE_WIDTH, widest * 8 + 48));
  const height = Math.min(1200, Math.max(160, lines * 22 + 48));
  return { width, height };
}

export interface PileTransformResult {
  item: Awaited<ReturnType<typeof prisma.canvasItem.create>>;
  kind: PileTransformKind;
  itemsConsumed: number;
  usage: AiUsageSnapshot;
}

export async function transformPileIntoNote(input: {
  canvasId: string;
  frameId: string;
  kind: PileTransformKind;
  userId: string;
  email: string;
}): Promise<PileTransformResult> {
  const { canvasId, frameId, kind, userId, email } = input;
  await requireCanvasAccess(canvasId, userId, email, "EDIT");

  const frame = await prisma.canvasItem.findFirst({
    where: { id: frameId, canvasId, type: ItemType.FRAME, deletedAt: null },
    select: {
      id: true,
      positionX: true,
      positionY: true,
      width: true,
      height: true,
      content: true,
    },
  });
  if (!frame) throw notFoundError("Frame", frameId);

  // An item belongs to the pile when its top-left corner sits in the frame.
  const items = await prisma.canvasItem.findMany({
    where: {
      canvasId,
      deletedAt: null,
      type: { in: READABLE_TYPES },
      positionX: { gte: frame.positionX, lte: frame.positionX + frame.width },
      positionY: { gte: frame.positionY, lte: frame.positionY + frame.height },
    },
    orderBy: [{ positionY: "asc" }, { positionX: "asc" }, { id: "asc" }],
    take: AI_SUMMARY_ITEM_LIMIT,
    select: { type: true, content: true },
  });

  const content = buildPileContent(items);
  if (!content) {
    throw new UnprocessableEntityError("This pile has no text to work from.");
  }

  // Check before reserving budget so an unconfigured provider costs nothing.
  const availability = await getAiAvailability(userId);
  if (!availability.configured) {
    throw new ServiceUnavailableError(AI_NOT_CONFIGURED_DETAIL);
  }

  const title = str(asRecord(frame.content).title);
  const spec = KIND_SPECS[kind];
  const prompt = buildPilePrompt(kind, title, content);
  const budgeted = await runBudgetedAi(
    userId,
    { prompt: `${spec.system}\n${prompt}`, maxOutputTokens: spec.maxTokens },
    () =>
      generateText({
        prompt,
        system: spec.system,
        temperature: 0.3,
        maxTokens: spec.maxTokens,
        userId,
      }),
  );

  const document = buildPileNoteDocument(kind, title, budgeted.value);
  const size = estimateNoteSize(document);

  const item = await prisma.$transaction(async (tx) => {
    await lockCanvasForMutation(tx, canvasId);
    // Access may have been revoked while the model was answering.
    await requireCanvasAccess(canvasId, userId, email, "EDIT", tx);
    await assertCanvasItemCapacity(tx, canvasId);
    const top = await tx.canvasItem.aggregate({
      where: { canvasId, deletedAt: null },
      _max: { zIndex: true },
    });
    const data = createCanvasItemSchema.parse({
      canvasId,
      type: ItemType.NOTE,
      positionX: frame.positionX + frame.width + NOTE_GAP,
      positionY: frame.positionY,
      width: size.width,
      height: size.height,
      zIndex: Math.min(MAX_ZINDEX, (top._max.zIndex ?? 0) + 1),
      content: { formatVersion: 1, document },
    });
    const validatedContent = parseCanvasItemContent(data.type, data.content);
    const created = await tx.canvasItem.create({
      data: {
        canvasId,
        type: data.type,
        positionX: data.positionX,
        positionY: data.positionY,
        width: data.width,
        height: data.height,
        zIndex: data.zIndex,
        content: validatedContent as Prisma.InputJsonValue,
        tags: data.tags,
        version: 1,
        createdById: userId,
        updatedById: userId,
      },
    });
    await recordCanvasItemEvent(tx, {
      canvasId,
      actorId: userId,
      itemId: created.id,
      version: created.version,
      operation: "created",
    });
    return created;
  });

  await invalidateCanvasCache(canvasId);
  await logActivity({
    userId,
    type: ActivityType.ITEM_CREATED,
    canvasId,
    itemId: item.id,
    metadata: { source: "ai-pile", kind, frameId },
  });

  return { item, kind, itemsConsumed: items.length, usage: budgeted.usage };
}
