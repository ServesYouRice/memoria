import { describe, expect, it } from "vitest";
import {
  describePiles,
  pilesSchema,
  planPileLayout,
  suggestPiles,
} from "@/lib/agents/piles";
import { findOpenSlot } from "@/lib/agents/inbox";

function bookmark(id: string, url: string, title: string, tags: string[] = []) {
  return { id, type: "BOOKMARK", content: { url, title }, tags };
}

function note(id: string, plainText: string, tags: string[] = []) {
  return { id, type: "NOTE", content: { plainText, text: plainText }, tags };
}

describe("suggestPiles", () => {
  it("groups items by the word they share most, then by website", () => {
    const piles = suggestPiles([
      bookmark("a", "https://cooking.example/pasta", "Easy pasta recipe"),
      bookmark("b", "https://food.example/curry", "Weeknight curry recipe"),
      note("c", "Grandma's soup recipe with lentils"),
      bookmark("d", "https://docs.python.org/3/tutorial", "Python tutorial"),
      bookmark(
        "e",
        "https://realpython.example/async",
        "Async python patterns",
      ),
      bookmark("f", "https://github.com/acme/one", "Acme one"),
      bookmark("g", "https://github.com/zed/two", "Zed two"),
      note("h", "Call the plumber on Monday"),
    ]);

    expect(piles).toEqual([
      { title: "Recipe", itemIds: ["a", "b", "c"] },
      { title: "Python", itemIds: ["d", "e"] },
      { title: "github.com", itemIds: ["f", "g"] },
    ]);
  });

  it("prefers the user's own tags over shared words", () => {
    const piles = suggestPiles([
      note("a", "pancakes with blueberries", ["breakfast"]),
      note("b", "overnight oats with blueberries", ["breakfast"]),
      note("c", "blueberries smoothie"),
    ]);

    expect(piles[0]).toEqual({ title: "Breakfast", itemIds: ["a", "b"] });
  });

  it("leaves items alone when nothing is shared", () => {
    expect(
      suggestPiles([note("a", "alpha bravo"), note("b", "charlie delta")]),
    ).toEqual([]);
    expect(suggestPiles([])).toEqual([]);
  });

  it("never puts one item in two piles and respects the pile limit", () => {
    const items = Array.from({ length: 30 }, (_, index) =>
      note(`n${index}`, `topic${index % 10} shared${index % 3}`),
    );
    const piles = suggestPiles(items, { maxPiles: 4 });
    const ids = piles.flatMap((pile) => pile.itemIds);

    expect(piles.length).toBeLessThanOrEqual(4);
    expect(new Set(ids).size).toBe(ids.length);
    expect(pilesSchema.safeParse(piles).success).toBe(true);
  });
});

describe("pilesSchema", () => {
  it("rejects an item placed in two piles", () => {
    const result = pilesSchema.safeParse([
      { title: "One", itemIds: ["x"] },
      { title: "Two", itemIds: ["x"] },
    ]);
    expect(result.success).toBe(false);
  });

  it("rejects empty and oversized proposals", () => {
    expect(pilesSchema.safeParse([]).success).toBe(false);
    expect(
      pilesSchema.safeParse(
        Array.from({ length: 13 }, (_, index) => ({
          title: `P${index}`,
          itemIds: [`i${index}`],
        })),
      ).success,
    ).toBe(false);
  });
});

describe("planPileLayout", () => {
  it("puts each pile's items inside its own non-overlapping frame", () => {
    const layout = planPileLayout(
      [
        {
          title: "A",
          items: [
            { id: "a1", width: 300, height: 100 },
            { id: "a2", width: 200, height: 200 },
            { id: "a3", width: 300, height: 100 },
          ],
        },
        { title: "B", items: [{ id: "b1", width: 360, height: 120 }] },
        { title: "C", items: [{ id: "c1", width: 100, height: 100 }] },
        { title: "D", items: [{ id: "d1", width: 100, height: 100 }] },
      ],
      { x: 1000, y: 50 },
    );

    expect(layout.frames).toHaveLength(4);
    expect(layout.frames[0]).toMatchObject({ x: 1000, y: 50 });
    // Three frames per row, so the fourth starts a new row below the first.
    expect(layout.frames[3].x).toBe(1000);
    expect(layout.frames[3].y).toBeGreaterThan(
      layout.frames[0].y + layout.frames[0].height,
    );

    const sizes = new Map([
      ["a1", [300, 100]],
      ["a2", [200, 200]],
      ["a3", [300, 100]],
      ["b1", [360, 120]],
      ["c1", [100, 100]],
      ["d1", [100, 100]],
    ]);
    const owner: Record<string, number> = { a: 0, b: 1, c: 2, d: 3 };
    for (const [id, [width, height]] of sizes) {
      const position = layout.positions.get(id)!;
      const frame = layout.frames[owner[id[0]]];
      expect(position.x).toBeGreaterThanOrEqual(frame.x);
      expect(position.y).toBeGreaterThanOrEqual(frame.y);
      expect(position.x + width).toBeLessThanOrEqual(frame.x + frame.width);
      expect(position.y + height).toBeLessThanOrEqual(frame.y + frame.height);
    }

    for (let i = 0; i < layout.frames.length; i += 1) {
      for (let j = i + 1; j < layout.frames.length; j += 1) {
        const a = layout.frames[i];
        const b = layout.frames[j];
        const apart =
          a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y;
        expect(apart).toBe(true);
      }
    }
  });

  it("summarizes a proposal in plain words", () => {
    expect(
      describePiles([
        { title: "Recipes", itemIds: ["a", "b"] },
        { title: "Python", itemIds: ["c"] },
      ]),
    ).toBe("Sort 3 items into 2 piles: Recipes, Python");
  });
});

describe("findOpenSlot", () => {
  it("starts at the origin on an empty board", () => {
    expect(findOpenSlot([], { width: 360, height: 120 })).toEqual({
      x: 80,
      y: 80,
    });
  });

  it("skips cells already covered by items", () => {
    const occupied = [
      { positionX: 80, positionY: 80, width: 360, height: 120 },
      { positionX: 480, positionY: 80, width: 360, height: 120 },
    ];
    expect(findOpenSlot(occupied, { width: 360, height: 120 })).toEqual({
      x: 880,
      y: 80,
    });
  });
});
