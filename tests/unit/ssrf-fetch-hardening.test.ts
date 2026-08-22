import { describe, expect, it } from "vitest";
import { isPrivateIp, validateUrlForSsrf } from "@/lib/utils/ssrf-protection";
import { parseCanvasItemContent, MAX_ITEM_CONTENT_BYTES } from "@/lib/validation/canvas-item";
import { ItemType } from "@/types/canvas";
import { NextRequest, NextResponse } from "next/server";
import { applyCors, handleCorsPreflight } from "@/middleware/cors";

describe("fetch, upload, and request hardening (IMP-043)", () => {
  describe("SSRF and private IP classification", () => {
    it("identifies private IPv4 addresses accurately", () => {
      expect(isPrivateIp("127.0.0.1")).toBe(true);
      expect(isPrivateIp("10.0.0.1")).toBe(true);
      expect(isPrivateIp("172.16.0.1")).toBe(true);
      expect(isPrivateIp("172.31.255.255")).toBe(true);
      expect(isPrivateIp("192.168.1.1")).toBe(true);
      expect(isPrivateIp("169.254.169.254")).toBe(true);
      expect(isPrivateIp("0.0.0.0")).toBe(true);
      expect(isPrivateIp("224.0.0.1")).toBe(true);

      // Public IPs
      expect(isPrivateIp("8.8.8.8")).toBe(false);
      expect(isPrivateIp("1.1.1.1")).toBe(false);
      expect(isPrivateIp("93.184.216.34")).toBe(false);
    });

    it("identifies private IPv6 addresses accurately", () => {
      expect(isPrivateIp("::1")).toBe(true);
      expect(isPrivateIp("fe80::1")).toBe(true);
      expect(isPrivateIp("fc00::1")).toBe(true);
      expect(isPrivateIp("fd12:3456:789a::1")).toBe(true);
      expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
      expect(isPrivateIp("::ffff:192.168.1.1")).toBe(true);

      // Public IPv6
      expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
    });

    it("rejects non-HTTP protocols and local hostnames in validateUrlForSsrf", () => {
      expect(validateUrlForSsrf("ftp://example.com").valid).toBe(false);
      expect(validateUrlForSsrf("file:///etc/passwd").valid).toBe(false);
      expect(validateUrlForSsrf("gopher://example.com").valid).toBe(false);
      expect(validateUrlForSsrf("http://localhost:3000").valid).toBe(false);
      expect(validateUrlForSsrf("http://127.0.0.1:5432").valid).toBe(false);
      expect(validateUrlForSsrf("http://user:pass@example.com").valid).toBe(false);
      expect(validateUrlForSsrf("https://example.com").valid).toBe(true);
    });
  });

  describe("CORS Vary: Origin cache header", () => {
    it("sets Vary: Origin on reflected CORS responses", () => {
      const request = new NextRequest("http://localhost:3000/api/v1/canvases", {
        headers: { origin: "http://localhost:3000" },
      });
      const response = NextResponse.next();

      applyCors(request, response);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
      expect(response.headers.get("Vary")).toContain("Origin");
    });

    it("sets Vary: Origin on OPTIONS preflight responses", () => {
      const request = new NextRequest("http://localhost:3000/api/v1/canvases", {
        method: "OPTIONS",
        headers: { origin: "http://localhost:3000" },
      });

      const preflight = handleCorsPreflight(request);
      expect(preflight).not.toBeNull();
      expect(preflight?.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
      expect(preflight?.headers.get("Vary")).toBe("Origin");
    });
  });

  describe("item content structural and byte limits", () => {
    it("accepts valid bounded item contents", () => {
      const validBookmark = {
        url: "https://example.com/article",
        title: "Valid Title",
        description: "Valid Description",
      };
      const parsed = parseCanvasItemContent(ItemType.BOOKMARK, validBookmark);
      expect(parsed.url).toBe("https://example.com/article");
      expect(parsed.title).toBe("Valid Title");
    });

    it("rejects item content exceeding the MAX_ITEM_CONTENT_BYTES cap", () => {
      const oversizedText = {
        text: "x".repeat(MAX_ITEM_CONTENT_BYTES + 100),
      };
      expect(() => {
        parseCanvasItemContent(ItemType.TEXT, oversizedText);
      }).toThrowError(/exceeds maximum byte size/);
    });

    it("enforces structural bounds on drawing points", () => {
      const oversizedDrawing = {
        paths: [
          {
            points: Array.from({ length: 3000 }, () => 1), // Max is 2000
            stroke: "#000",
            strokeWidth: 2,
          },
        ],
      };
      expect(() => {
        parseCanvasItemContent(ItemType.DRAWING, oversizedDrawing);
      }).toThrowError();
    });
  });
});
