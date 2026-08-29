import { describe, expect, it } from "vitest";
import { canvasThumbnailUrl } from "@/lib/thumbnails/url";

describe("stored thumbnail display URL", () => {
  it("displays the authorized asset route with its stable revision cache key", () => {
    expect(
      canvasThumbnailUrl({
        id: "canvas-1",
        thumbnailKey: "thumbnails/canvas-1/42.jpg",
        thumbnailRevision: "42",
      }),
    ).toBe("/api/v1/canvases/canvas-1/thumbnail?v=42");
  });

  it("does not request a derivative that has not been installed", () => {
    expect(
      canvasThumbnailUrl({
        id: "canvas-1",
        thumbnailKey: null,
        thumbnailRevision: "42",
      }),
    ).toBeNull();
  });
});
