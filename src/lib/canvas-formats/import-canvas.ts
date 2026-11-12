/**
 * Write an imported canvas file (IMP-096): a new canvas with the file's
 * items, created in one transaction within the canvas and item limits. Every
 * item passes the same content validation as an item made by hand.
 */

import { randomBytes } from "crypto";
import {
  ItemType,
  type Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import { ValidationError } from "@/lib/errors";
import { recordCanvasItemEventsBatch } from "@/lib/collaboration/committed-events";
import { assertCanvasCapacity } from "@/lib/policy/capacity";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";
import { parseCanvasItemContent } from "@/lib/validation/canvas-item";
import {
  arrowEnds,
  arrowGeometry,
  canAttachArrowTo,
} from "@/features/canvas/lib/arrow-attachment";
import type { CanvasItem } from "@/types/canvas";
import { looksLikeExcalidraw, planExcalidraw } from "./excalidraw";
import { looksLikeJsonCanvas, planJsonCanvas } from "./json-canvas";
import {
  bump,
  type CanvasFileFormat,
  type ImportPlan,
  type PlannedItem,
} from "./types";

/** A cuid-shaped id, so arrow content can name an item before it exists. */
function newItemId() {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(24);
  let id = "c";
  for (const byte of bytes) id += alphabet[byte % alphabet.length];
  return id;
}

/** Which format a file is in, from its name and then its contents. */
export function detectCanvasFormat(
  fileName: string,
  value: unknown,
): CanvasFileFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".excalidraw")) return "excalidraw";
  if (lower.endsWith(".canvas")) return "json-canvas";
  if (looksLikeExcalidraw(value)) return "excalidraw";
  if (looksLikeJsonCanvas(value)) return "json-canvas";
  throw new ValidationError(
    "This is not a .canvas or .excalidraw file Memoria can read.",
  );
}

export function planCanvasFile(text: string, fileName: string) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ValidationError("This file is not valid JSON.");
  }
  const format = detectCanvasFormat(fileName, value);
  try {
    return {
      format,
      plan:
        format === "excalidraw" ? planExcalidraw(value) : planJsonCanvas(value),
    };
  } catch {
    throw new ValidationError(
      format === "excalidraw"
        ? "This Excalidraw file could not be read."
        : "This JSON Canvas file could not be read.",
    );
  }
}

interface Row {
  planned: PlannedItem;
  id: string;
  content: Record<string, unknown>;
}

/**
 * The rows to write: validated, within the item limit, with arrows attached
 * by id and redrawn between their items.
 */
export function resolvePlan(plan: ImportPlan) {
  const leftOut = { ...plan.leftOut };
  const rows: Row[] = [];
  const idByKey = new Map<string, string>();
  const boxes = new Map<string, CanvasItem>();
  const ordered = [
    ...plan.items.filter((item) => item.type !== ItemType.ARROW),
    ...plan.items.filter((item) => item.type === ItemType.ARROW),
  ];
  for (const planned of ordered) {
    if (rows.length >= LAUNCH_LIMITS.itemsPerCanvas) {
      bump(leftOut, "items over the canvas limit");
      continue;
    }
    let content = planned.content;
    if (planned.type === ItemType.ARROW) {
      const startId = planned.startKey
        ? idByKey.get(planned.startKey)
        : undefined;
      const endId = planned.endKey ? idByKey.get(planned.endKey) : undefined;
      const attachable = (id?: string) => {
        const box = id ? boxes.get(id) : undefined;
        return box && canAttachArrowTo(box) ? id : undefined;
      };
      const startItemId = attachable(startId);
      const endItemId = attachable(endId);
      content = {
        ...content,
        ...(startItemId ? { startItemId } : {}),
        ...(endItemId && endItemId !== startItemId ? { endItemId } : {}),
      };
      if (!content.startPoint && !(startItemId && content.endItemId)) {
        bump(leftOut, "connections to missing nodes");
        continue;
      }
    }
    let parsed: unknown;
    try {
      parsed = parseCanvasItemContent(planned.type, content);
    } catch {
      bump(leftOut, "items that failed checks");
      continue;
    }
    const id = newItemId();
    idByKey.set(planned.key, id);
    const row = { planned, id, content: parsed as Record<string, unknown> };
    boxes.set(id, {
      id,
      type: planned.type,
      positionX: planned.positionX,
      positionY: planned.positionY,
      width: planned.width,
      height: planned.height,
      content: row.content,
    } as unknown as CanvasItem);
    rows.push(row);
  }

  // Attached arrows are drawn edge to edge between their items.
  for (const row of rows) {
    if (row.planned.type !== ItemType.ARROW) continue;
    if (!row.content.startItemId && !row.content.endItemId) continue;
    const ends = arrowEnds(
      {
        positionX: row.planned.positionX,
        positionY: row.planned.positionY,
        content: row.content as CanvasItem["content"],
      },
      boxes,
    );
    const geometry = arrowGeometry(ends.start, ends.end);
    row.planned = {
      ...row.planned,
      positionX: geometry.positionX,
      positionY: geometry.positionY,
      width: geometry.width,
      height: geometry.height,
    };
    row.content = {
      ...row.content,
      startPoint: geometry.startPoint,
      endPoint: geometry.endPoint,
    };
  }

  // What was brought in, counted from what is written.
  const brought: Record<string, number> = {};
  for (const row of rows)
    bump(brought, BROUGHT_KIND[row.planned.type] ?? "items");
  return { rows, brought, leftOut };
}

const BROUGHT_KIND: Partial<Record<ItemType, string>> = {
  [ItemType.NOTE]: "notes",
  [ItemType.TEXT]: "text",
  [ItemType.BOOKMARK]: "links",
  [ItemType.FRAME]: "groups and frames",
  [ItemType.SHAPE]: "shapes",
  [ItemType.ARROW]: "arrows",
  [ItemType.DRAWING]: "free drawings",
};

/** File order, with linking arrows under everything. */
function zIndexOf(row: Row, index: number) {
  return row.planned.type === ItemType.ARROW &&
    (row.content.startItemId || row.content.endItemId)
    ? 0
    : index + 1;
}

export async function importCanvasFile(
  prisma: PrismaClient,
  input: { userId: string; name: string; text: string; fileName: string },
) {
  const { format, plan } = planCanvasFile(input.text, input.fileName);
  const { rows, brought, leftOut } = resolvePlan(plan);
  if (rows.length === 0) {
    throw new ValidationError("This file has nothing Memoria can bring in.");
  }

  const canvas = await prisma.$transaction(async (tx) => {
    await assertCanvasCapacity(tx, input.userId);
    const created = await tx.canvas.create({
      data: { name: input.name, userId: input.userId },
    });
    const items = await tx.canvasItem.createManyAndReturn({
      data: rows.map((row, index): Prisma.CanvasItemCreateManyInput => ({
        id: row.id,
        canvasId: created.id,
        type: row.planned.type,
        positionX: row.planned.positionX,
        positionY: row.planned.positionY,
        width: row.planned.width,
        height: row.planned.height,
        zIndex: zIndexOf(row, index),
        content: row.content as Prisma.InputJsonValue,
        createdById: input.userId,
        updatedById: input.userId,
      })),
      select: { id: true, version: true },
    });
    await recordCanvasItemEventsBatch(
      tx,
      items.map((item) => ({
        canvasId: created.id,
        actorId: input.userId,
        itemId: item.id,
        version: item.version,
        operation: "created" as const,
      })),
    );
    return created;
  });

  return {
    canvasId: canvas.id,
    name: canvas.name,
    format,
    itemCount: rows.length,
    brought,
    leftOut,
  };
}
