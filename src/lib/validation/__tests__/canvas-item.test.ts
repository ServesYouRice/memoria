/**
 * Unit tests for Canvas Item validation schemas
 * Testing bookmark URL validation and schema rules
 */

import { describe, it, expect } from "vitest";
import {
  bookmarkContentSchema,
  noteContentSchema,
  createCanvasItemSchema,
  updateCanvasItemSchema,
} from "../canvas-item";
import { ItemType } from "@/types/canvas";

describe("bookmarkContentSchema", () => {
  it("should accept valid http URLs", () => {
    const result = bookmarkContentSchema.safeParse({
      url: "http://example.com",
    });
    expect(result.success).toBe(true);
  });

  it("should accept valid https URLs", () => {
    const result = bookmarkContentSchema.safeParse({
      url: "https://example.com/path?query=value",
    });
    expect(result.success).toBe(true);
  });

  it("should reject non-http(s) protocols", () => {
    const result = bookmarkContentSchema.safeParse({
      url: "ftp://example.com",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("http");
    }
  });

  it("should reject javascript: URLs (XSS protection)", () => {
    const result = bookmarkContentSchema.safeParse({
      url: 'javascript:alert("xss")',
    });
    expect(result.success).toBe(false);
  });

  it("should reject file: URLs", () => {
    const result = bookmarkContentSchema.safeParse({
      url: "file:///etc/passwd",
    });
    expect(result.success).toBe(false);
  });

  it("should reject invalid URL format", () => {
    const result = bookmarkContentSchema.safeParse({
      url: "not a url",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("Invalid URL");
    }
  });

  it("should reject URLs longer than 2048 characters", () => {
    const longUrl = "https://example.com/" + "a".repeat(2050);
    const result = bookmarkContentSchema.safeParse({
      url: longUrl,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("2048");
    }
  });

  it("should accept URLs with special characters", () => {
    const result = bookmarkContentSchema.safeParse({
      url: "https://example.com/path?q=hello%20world&foo=bar#section",
    });
    expect(result.success).toBe(true);
  });

  it("should accept URLs with authentication", () => {
    const result = bookmarkContentSchema.safeParse({
      url: "https://user:pass@example.com/path",
    });
    expect(result.success).toBe(true);
  });
});

describe("noteContentSchema", () => {
  it("should accept valid note text", () => {
    const result = noteContentSchema.safeParse({
      text: "This is a note",
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty text", () => {
    const result = noteContentSchema.safeParse({
      text: "",
    });
    expect(result.success).toBe(false);
  });

  it("should reject text longer than 10000 characters", () => {
    const longText = "a".repeat(10001);
    const result = noteContentSchema.safeParse({
      text: longText,
    });
    expect(result.success).toBe(false);
  });
});

describe("createCanvasItemSchema", () => {
  it("should accept valid bookmark creation", () => {
    const result = createCanvasItemSchema.safeParse({
      canvasId: "clabcdef1234567890",
      type: ItemType.BOOKMARK,
      positionX: 100,
      positionY: 200,
      width: 300,
      height: 100,
      zIndex: 5,
      content: {
        url: "https://example.com",
      },
    });
    expect(result.success).toBe(true);
  });

  it("should accept valid note creation", () => {
    const result = createCanvasItemSchema.safeParse({
      canvasId: "clabcdef1234567890",
      type: ItemType.NOTE,
      positionX: 100,
      positionY: 200,
      width: 200,
      height: 150,
      content: {
        text: "Hello world",
      },
    });
    expect(result.success).toBe(true);
  });

  it("should default zIndex to 0 if not provided", () => {
    const result = createCanvasItemSchema.safeParse({
      canvasId: "clabcdef1234567890",
      type: ItemType.BOOKMARK,
      positionX: 100,
      positionY: 200,
      width: 300,
      height: 100,
      content: {
        url: "https://example.com",
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.zIndex).toBe(0);
    }
  });

  it("should reject negative width", () => {
    const result = createCanvasItemSchema.safeParse({
      canvasId: "clabcdef1234567890",
      type: ItemType.BOOKMARK,
      positionX: 100,
      positionY: 200,
      width: -300,
      height: 100,
      content: {
        url: "https://example.com",
      },
    });
    expect(result.success).toBe(false);
  });

  it("should reject invalid canvasId format", () => {
    const result = createCanvasItemSchema.safeParse({
      canvasId: "not-a-cuid",
      type: ItemType.BOOKMARK,
      positionX: 100,
      positionY: 200,
      width: 300,
      height: 100,
      content: {
        url: "https://example.com",
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("updateCanvasItemSchema", () => {
  it("should accept position update with version", () => {
    const result = updateCanvasItemSchema.safeParse({
      version: 5,
      positionX: 150,
      positionY: 250,
    });
    expect(result.success).toBe(true);
  });

  it("should accept content update with version", () => {
    const result = updateCanvasItemSchema.safeParse({
      version: 3,
      content: {
        url: "https://newurl.com",
      },
    });
    expect(result.success).toBe(true);
  });

  it("should require version field", () => {
    const result = updateCanvasItemSchema.safeParse({
      positionX: 150,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((e) => e.path.includes("version"))).toBe(
        true,
      );
    }
  });

  it("should reject zero or negative version", () => {
    const result1 = updateCanvasItemSchema.safeParse({
      version: 0,
      positionX: 150,
    });
    expect(result1.success).toBe(false);

    const result2 = updateCanvasItemSchema.safeParse({
      version: -1,
      positionX: 150,
    });
    expect(result2.success).toBe(false);
  });

  it("should accept partial geometry updates", () => {
    const result = updateCanvasItemSchema.safeParse({
      version: 2,
      width: 400,
    });
    expect(result.success).toBe(true);
  });
});
