import { describe, expect, it } from "vitest";
import { isUploadWriteRequest } from "@/proxy";

describe("upload rate-limit routing", () => {
  it.each([
    ["/api/v1/upload", "POST", true],
    ["/api/v1/upload", "GET", false],
    ["/api/v1/uploads/asset-1", "GET", false],
    ["/api/v1/uploads/asset-1", "DELETE", false],
    // Bookmark file imports are uploads too (IMP-091).
    ["/api/v1/imports", "POST", true],
    ["/api/v1/imports/preview", "POST", true],
    ["/api/v1/imports", "GET", false],
    // So are canvas files (IMP-096).
    ["/api/v1/canvases/import", "POST", true],
    ["/api/v1/canvases", "POST", false],
  ])("classifies %s %s", (pathname, method, expected) => {
    expect(isUploadWriteRequest(pathname, method)).toBe(expected);
  });
});
