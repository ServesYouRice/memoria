import { describe, expect, it } from "vitest";
import { isUploadWriteRequest } from "@/proxy";

describe("upload rate-limit routing", () => {
  it.each([
    ["/api/v1/upload", "POST", true],
    ["/api/v1/upload", "GET", false],
    ["/api/v1/uploads/asset-1", "GET", false],
    ["/api/v1/uploads/asset-1", "DELETE", false],
  ])("classifies %s %s", (pathname, method, expected) => {
    expect(isUploadWriteRequest(pathname, method)).toBe(expected);
  });
});
