import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/provider-resolution", () => ({
  getAiAvailability: vi.fn().mockResolvedValue({ configured: false }),
}));

import {
  pilesSchema,
  suggestPiles,
  suggestPilesForOwner,
} from "@/lib/agents/piles";

function note(id: string, text: string, tags: string[] = []) {
  return { id, type: "NOTE", content: { text }, tags };
}
function bookmark(id: string, url: string, title: string) {
  return { id, type: "BOOKMARK", content: { url, title }, tags: [] };
}

const sharedTag = Array.from({ length: 2_000 }, (_, index) =>
  note(`tag-${index}`, `entry ${index}`, ["reading"]),
);
const longToken = "x".repeat(300);
const longKeyword = [
  ...Array.from({ length: 3 }, (_, index) =>
    note(`kw-${index}`, `${longToken} alpha${index}`),
  ),
  note("other-1", "garden tomatoes"),
  note("other-2", "violin lessons"),
];
const longHost = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(58)}.io`;
const hostItems = Array.from({ length: 3 }, (_, index) =>
  bookmark(`host-${index}`, `https://${longHost}/${index}`, `${index}`),
);

describe("built-in piles stay inside pilesSchema", () => {
  it.each([
    ["2,000 items sharing a tag", sharedTag],
    ["a very long keyword token", longKeyword],
    ["a 253-character hostname", hostItems],
  ])("for %s", (_label, items) => {
    expect(longHost.length).toBe(253);
    const piles = suggestPiles(items);
    expect(piles.length).toBeGreaterThan(0);
    const result = pilesSchema.safeParse(piles);
    expect(result.error?.issues ?? []).toEqual([]);
    const total = piles.reduce((sum, pile) => sum + pile.itemIds.length, 0);
    expect(total).toBeLessThanOrEqual(500);
  });

  it("keeps the words fallback valid on large boards", async () => {
    const result = await suggestPilesForOwner({
      userId: "u1",
      items: [...sharedTag, ...hostItems],
    });
    expect(result.method).toBe("words");
    expect(pilesSchema.safeParse(result.piles).success).toBe(true);
  });
});
