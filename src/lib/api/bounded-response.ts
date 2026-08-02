import { NextResponse } from "next/server";
import { canvasItemResponseSchema } from "@/lib/api/response-schemas";
import { InternalServerError } from "@/lib/errors";

export const ITEM_RESPONSE_BYTE_BUDGET = 512 * 1024;

export function boundedItemsResponse<T>(
  items: T[],
  metadata: Record<string, unknown>,
  byteBudget = ITEM_RESPONSE_BYTE_BUDGET,
) {
  const accepted: T[] = [];
  let body = { ...metadata, items: accepted, truncatedByBytes: false };
  for (const item of items) {
    if (!canvasItemResponseSchema.safeParse(item).success) {
      throw new InternalServerError("Canvas item response contract failed");
    }
    accepted.push(item);
    if (Buffer.byteLength(JSON.stringify(body), "utf8") > byteBudget) {
      accepted.pop();
      body = { ...metadata, items: accepted, truncatedByBytes: true };
      break;
    }
  }
  return NextResponse.json(body);
}
