import { describe, expect, it } from "vitest";
import { hashCanvasContent } from "@/lib/versions/snapshot";
import {
  AUTO_KEEP_ALL_MS,
  AUTO_KEEP_DAILY_MS,
  AUTO_KEEP_HOURLY_MS,
  AUTO_SNAPSHOT_INTERVAL_MS,
  AUTO_SNAPSHOT_SWEEP_MS,
  autoRetentionDedupeKey,
  autoSnapshotDedupeKey,
  autoSnapshotName,
} from "@/lib/versions/policy";
import {
  previewLabel,
  toPreviewBoxes,
} from "@/features/canvas/components/VersionPreview";

const item = {
  id: "a",
  type: "NOTE",
  positionX: 1,
  positionY: 2,
  width: 3,
  height: 4,
  zIndex: 0,
  tags: ["x"],
  content: { text: "hello", nested: { b: 1, a: 2 } },
};

describe("version history policy", () => {
  it("keeps the documented retention tiers and snapshot cadence", () => {
    expect(AUTO_SNAPSHOT_INTERVAL_MS).toBe(10 * 60_000);
    expect(AUTO_SNAPSHOT_SWEEP_MS).toBeLessThan(AUTO_SNAPSHOT_INTERVAL_MS);
    expect(AUTO_KEEP_ALL_MS).toBe(24 * 3_600_000);
    expect(AUTO_KEEP_HOURLY_MS).toBe(7 * 86_400_000);
    expect(AUTO_KEEP_DAILY_MS).toBe(30 * 86_400_000);
  });

  it("derives stable dedupe keys per time bucket", () => {
    const at = new Date("2026-08-25T14:32:10.000Z");
    const sameBucket = new Date("2026-08-25T14:34:59.000Z");
    const nextBucket = new Date("2026-08-25T14:35:00.000Z");
    expect(autoSnapshotDedupeKey(at)).toBe(autoSnapshotDedupeKey(sameBucket));
    expect(autoSnapshotDedupeKey(at)).not.toBe(
      autoSnapshotDedupeKey(nextBucket),
    );
    expect(autoRetentionDedupeKey(at)).toBe(
      autoRetentionDedupeKey(new Date("2026-08-25T14:59:59.000Z")),
    );
    expect(autoRetentionDedupeKey(at)).not.toBe(
      autoRetentionDedupeKey(new Date("2026-08-25T15:00:00.000Z")),
    );
  });

  it("names automatic snapshots by their UTC time", () => {
    expect(autoSnapshotName(new Date("2026-08-25T14:32:10.000Z"))).toBe(
      "Auto-save 2026-08-25 14:32 UTC",
    );
  });
});

describe("canvas content hash", () => {
  it("ignores key order, item order, and row bookkeeping", () => {
    const reordered = {
      ...item,
      content: { nested: { a: 2, b: 1 }, text: "hello" },
    };
    const other = { ...item, id: "b" };
    expect(hashCanvasContent("Board", [item, other])).toBe(
      hashCanvasContent("Board", [other, reordered]),
    );
    expect(
      hashCanvasContent("Board", [
        { ...item, version: 9, updatedById: "someone" } as typeof item,
      ]),
    ).toBe(hashCanvasContent("Board", [item]));
  });

  it("changes with the name, geometry, tags, and content", () => {
    const hash = hashCanvasContent("Board", [item]);
    expect(hashCanvasContent("Renamed", [item])).not.toBe(hash);
    expect(hashCanvasContent("Board", [{ ...item, positionX: 2 }])).not.toBe(
      hash,
    );
    expect(hashCanvasContent("Board", [{ ...item, tags: [] }])).not.toBe(hash);
    expect(
      hashCanvasContent("Board", [{ ...item, content: { text: "bye" } }]),
    ).not.toBe(hash);
    expect(hashCanvasContent("Board", [])).not.toBe(hash);
  });
});

describe("version preview geometry", () => {
  it("labels items with plain text and bounds the length", () => {
    expect(previewLabel("NOTE", { plainText: "  hello   world " })).toBe(
      "hello world",
    );
    expect(previewLabel("BOOKMARK", { title: "Docs", url: "https://x" })).toBe(
      "Docs",
    );
    expect(previewLabel("SHAPE", { shapeType: "star" })).toBe("shape");
    expect(previewLabel("NOTE", { text: "x".repeat(100) })).toHaveLength(40);
  });

  it("drops items without usable geometry", () => {
    const boxes = toPreviewBoxes({
      items: [
        {
          type: "NOTE" as never,
          positionX: 0,
          positionY: 0,
          width: 10,
          height: 10,
          zIndex: 0,
          content: {},
        },
        {
          type: "NOTE" as never,
          positionX: Number.NaN,
          positionY: 0,
          width: 10,
          height: 10,
          zIndex: 0,
          content: {},
        },
      ],
    });
    expect(boxes).toHaveLength(1);
    expect(toPreviewBoxes(null)).toEqual([]);
  });
});
