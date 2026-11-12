import { describe, expect, it } from "vitest";
import { ItemType, type CanvasItem } from "@/types/canvas";
import { exportToJSON, exportToMarkdown } from "@/lib/export/export-utils";
import { buildAskContext } from "@/lib/ai/ask-schema";

function item(
  id: string,
  type: ItemType,
  content: Record<string, unknown>,
): CanvasItem {
  return {
    id,
    canvasId: "c1",
    type,
    positionX: 0,
    positionY: 0,
    width: 100,
    height: 100,
    zIndex: 1,
    version: 1,
    content,
    tags: [],
    createdAt: "",
    updatedAt: "",
  } as CanvasItem;
}

const flights = item("a", ItemType.NOTE, { text: "Flights" });
const hotel = item("b", ItemType.NOTE, { text: "Hotel" });
const arrow = item("x", ItemType.ARROW, {
  startItemId: "a",
  endItemId: "b",
  label: "then",
  lineStyle: "DASHED",
});
const twin = item("y", ItemType.ARROW, { startItemId: "a", endItemId: "b" });
const loose = item("z", ItemType.ARROW, { startItemId: "a" });

describe("exports include links (IMP-095)", () => {
  it("JSON lists each linked pair once", async () => {
    const json = JSON.parse(
      await exportToJSON("c1", "Trip", [flights, hotel, arrow, twin, loose]),
    );
    expect(json.links).toEqual([
      { fromId: "a", toId: "b", label: "then", style: "DASHED" },
    ]);
  });

  it("Markdown ends with a Links section", async () => {
    const md = await exportToMarkdown("c1", "Trip", [flights, hotel, arrow]);
    expect(md).toContain("## Links\n\n- Flights → Hotel (then)\n");
    expect(await exportToMarkdown("c1", "Trip", [flights])).not.toContain(
      "## Links",
    );
  });
});

describe("Ask context includes links (IMP-095)", () => {
  it("names what an item is linked to, quoted as data", () => {
    const { context } = buildAskContext(
      [
        {
          id: "a",
          canvasId: "c1",
          canvasName: "Trip",
          type: "NOTE",
          title: "Flights",
          text: "Flights",
          url: null,
          tags: [],
          links: [
            { direction: "to", title: "Hotel", label: "then" },
            { direction: "from", title: 'Plan "B"' },
          ],
        },
      ],
      [],
    );
    expect(context).toContain('linked: → "Hotel" (then); ← "Plan \\"B\\""');
  });
});
