import { NextResponse } from "next/server";
import { canvasItemResponseSchema } from "@/lib/api/response-schemas";
import { InternalServerError } from "@/lib/errors";
import { RESOURCE_BUDGETS } from "@/lib/policy/resource-budgets";

export const ITEM_RESPONSE_BYTE_BUDGET =
  RESOURCE_BUDGETS.canvas.viewportResponseBytes;

export interface ItemCursorTarget {
  id: string;
  zIndex: number;
}

export function encodeItemCursor(item: ItemCursorTarget): string {
  return Buffer.from(
    JSON.stringify({ z: item.zIndex, id: item.id }),
    "utf8",
  ).toString("base64url");
}

export function decodeItemCursor(
  cursor: string | null | undefined,
): ItemCursorTarget | null {
  if (!cursor || typeof cursor !== "string") return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.z === "number" &&
      Number.isInteger(parsed.z) &&
      typeof parsed.id === "string" &&
      parsed.id.length > 0
    ) {
      return { zIndex: parsed.z, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

export function boundedItemsResponse<T extends { id: string; zIndex: number }>(
  items: T[],
  metadata: Record<string, unknown>,
  byteBudget = ITEM_RESPONSE_BYTE_BUDGET,
) {
  const accepted: T[] = [];
  let truncatedByBytes = false;
  let accumulatedItemBytes = 0;

  // Measure envelope overhead with placeholder for pagination/cursor fields
  const sampleCursor =
    "eyJ6IjIxNDc0ODM2NDcsImlkIjoiY2p4eHh4eHh4eHh4eHh4eHh4eHh4eHgifQ";
  const envelopeWithSample = {
    ...metadata,
    items: [],
    truncatedByBytes: true,
    nextCursor: sampleCursor,
    hasMore: true,
  };
  const baseEnvelopeBytes = Buffer.byteLength(
    JSON.stringify(envelopeWithSample),
    "utf8",
  );

  for (const item of items) {
    if (!canvasItemResponseSchema.safeParse(item).success) {
      throw new InternalServerError("Canvas item response contract failed");
    }

    const itemJson = JSON.stringify(item);
    const itemBytes = Buffer.byteLength(itemJson, "utf8");
    const commaBytes = accepted.length > 0 ? 1 : 0;
    const projectedBytes =
      baseEnvelopeBytes + accumulatedItemBytes + commaBytes + itemBytes;

    if (projectedBytes > byteBudget) {
      truncatedByBytes = true;
      break;
    }

    accepted.push(item);
    accumulatedItemBytes += commaBytes + itemBytes;
  }

  const lastAccepted = accepted.at(-1);
  let nextCursor: string | null = null;
  let hasMore = false;

  if (truncatedByBytes) {
    hasMore = true;
    nextCursor = lastAccepted ? encodeItemCursor(lastAccepted) : null;
  } else {
    hasMore =
      typeof metadata.hasMore === "boolean"
        ? metadata.hasMore
        : typeof metadata.total === "number" &&
            typeof metadata.offset === "number"
          ? metadata.offset + accepted.length < metadata.total
          : false;
    nextCursor =
      hasMore && lastAccepted ? encodeItemCursor(lastAccepted) : null;
  }

  const body = {
    ...metadata,
    items: accepted,
    truncatedByBytes,
    nextCursor,
    hasMore,
  };

  return NextResponse.json(body);
}
