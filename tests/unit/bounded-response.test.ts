import { describe, expect, it } from "vitest";
import {
  boundedItemsResponse,
  decodeItemCursor,
  encodeItemCursor,
  ITEM_RESPONSE_BYTE_BUDGET,
} from "@/lib/api/bounded-response";
import {
  canvasItemListResponseSchema,
  canvasListResponseSchema,
  publicCanvasShareResponseSchema,
  sharedCanvasResponseSchema,
} from "@/lib/api/response-schemas";
import { ItemType } from "@/generated/prisma/client";

function makeItem(index: number, contentSize = 100) {
  return {
    id: `c${index.toString(36).padStart(24, "0")}`,
    canvasId: "c111111111111111111111111",
    type: ItemType.NOTE,
    positionX: index * 10,
    positionY: 0,
    width: 200,
    height: 200,
    zIndex: index,
    content: { text: "x".repeat(contentSize) },
    tags: ["tag1"],
    version: 1,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    deletedAt: null,
    createdById: "u111111111111111111111111",
    updatedById: null,
    deletedById: null,
  };
}

describe("bounded-response and cursor continuation", () => {
  describe("cursor encoding and decoding", () => {
    it("round-trips item zIndex and id accurately", () => {
      const item = { id: "c123456789012345678901234", zIndex: 42 };
      const cursor = encodeItemCursor(item);
      expect(typeof cursor).toBe("string");

      const decoded = decodeItemCursor(cursor);
      expect(decoded).toEqual({ id: "c123456789012345678901234", zIndex: 42 });
    });

    it("returns null for malformed or invalid cursors", () => {
      expect(decodeItemCursor("")).toBeNull();
      expect(decodeItemCursor(null)).toBeNull();
      expect(decodeItemCursor(undefined)).toBeNull();
      expect(decodeItemCursor("invalid-base64-!@#$")).toBeNull();
      expect(
        decodeItemCursor(Buffer.from("{}", "utf8").toString("base64url")),
      ).toBeNull();
      expect(
        decodeItemCursor(
          Buffer.from(JSON.stringify({ z: "not-a-number", id: "123" }), "utf8").toString(
            "base64url",
          ),
        ),
      ).toBeNull();
    });
  });

  describe("linear accumulation and byte bounding", () => {
    it("returns all items when within byte budget", async () => {
      const items = Array.from({ length: 20 }, (_, i) => makeItem(i, 50));
      const response = boundedItemsResponse(items, { total: 20, limit: 50, offset: 0 });

      const raw = await response.text();
      const body = JSON.parse(raw);
      expect(response.status).toBe(200);
      expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(ITEM_RESPONSE_BYTE_BUDGET);
      expect(body.items.length).toBe(20);
      expect(body.truncatedByBytes).toBe(false);
      expect(body.hasMore).toBe(false);
      expect(body.nextCursor).toBeNull();

      const parsed = canvasItemListResponseSchema.safeParse(body);
      expect(parsed.success).toBe(true);
    });

    it("truncates strictly when byte budget is exceeded and provides authoritative cursor", async () => {
      // 100 items of 10KB content each = ~1MB (exceeds 512KB budget)
      const items = Array.from({ length: 100 }, (_, i) => makeItem(i, 10_000));
      const response = boundedItemsResponse(items, { total: 100, limit: 100, offset: 0 });

      const raw = await response.text();
      const body = JSON.parse(raw);

      expect(response.status).toBe(200);
      expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(ITEM_RESPONSE_BYTE_BUDGET);
      expect(body.truncatedByBytes).toBe(true);
      expect(body.hasMore).toBe(true);
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items.length).toBeLessThan(100);
      expect(body.nextCursor).not.toBeNull();

      const lastAccepted = body.items.at(-1);
      const decodedCursor = decodeItemCursor(body.nextCursor);
      expect(decodedCursor).toEqual({
        id: lastAccepted.id,
        zIndex: lastAccepted.zIndex,
      });

      const parsed = canvasItemListResponseSchema.safeParse(body);
      expect(parsed.success).toBe(true);
    });

    it("simulates full exactly-once pagination traversal across byte boundaries", async () => {
      const allItems = Array.from({ length: 80 }, (_, i) => makeItem(i, 10_000));
      const budget = 200 * 1024; // 200 KB budget

      const collectedItems: unknown[] = [];
      let cursor: string | null = null;
      let hasMore = true;
      let iterations = 0;

      while (hasMore && iterations < 20) {
        // Filter items after cursor
        const cursorTarget = decodeItemCursor(cursor);
        const filtered = cursorTarget
          ? allItems.filter(
              (item) =>
                item.zIndex > cursorTarget.zIndex ||
                (item.zIndex === cursorTarget.zIndex && item.id > cursorTarget.id),
            )
          : allItems;

        const response = boundedItemsResponse(
          filtered,
          { total: allItems.length, limit: 50 },
          budget,
        );
        const raw = await response.text();
        const body = JSON.parse(raw);

        expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(budget);
        collectedItems.push(...body.items);
        hasMore = body.hasMore;
        cursor = body.nextCursor;
        iterations++;
      }

      // Assert all 80 items are collected exactly once without duplicates or omissions
      expect(collectedItems.length).toBe(80);
      const collectedIds = collectedItems.map((item: any) => item.id);
      const uniqueIds = new Set(collectedIds);
      expect(uniqueIds.size).toBe(80);
      expect(collectedIds).toEqual(allItems.map((item) => item.id));
    });
  });

  describe("response schemas and wire format conformance", () => {
    it("validates public share response wire format", () => {
      const payload = {
        canvas: {
          id: "c111111111111111111111111",
          name: "Shared Test",
          owner: "Alice",
          zoomLevel: 1.2,
          panX: 50,
          panY: 100,
        },
        items: [makeItem(0, 50)],
        total: 1,
        limit: 50,
        offset: 0,
        nextCursor: null,
        hasMore: false,
        truncatedByBytes: false,
      };

      const result = publicCanvasShareResponseSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("validates canvas list response with serialized string dates and thumbnail revisions", () => {
      const payload = {
        canvases: [
          {
            id: "c111111111111111111111111",
            name: "Canvas 1",
            userId: "u111111111111111111111111",
            workspaceId: null,
            zoomLevel: 1,
            panX: 0,
            panY: 0,
            thumbnailKey: "thumb/key/123",
            thumbnailRevision: "42",
            isPublic: true,
            createdAt: "2026-08-01T12:00:00.000Z",
            updatedAt: "2026-08-02T15:30:00.000Z",
          },
        ],
        pagination: {
          total: 1,
          limit: 24,
          offset: 0,
          hasMore: false,
        },
      };

      const result = canvasListResponseSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("validates shared canvas response", () => {
      const payload = {
        canvases: [
          {
            id: "c111111111111111111111111",
            name: "Shared With Me",
            thumbnailKey: null,
            thumbnailRevision: "0",
            itemCount: 5,
            owner: { name: "Bob" },
            role: "EDIT",
            sharedAt: "2026-08-01T12:00:00.000Z",
            updatedAt: "2026-08-01T12:00:00.000Z",
          },
        ],
      };

      const result = sharedCanvasResponseSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });
});
