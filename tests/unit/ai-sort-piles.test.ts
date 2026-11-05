import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ServiceModule from "@/lib/ai/service";

const mocks = vi.hoisted(() => ({
  getAiAvailability: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock("@/lib/ai/provider-resolution", () => ({
  getAiAvailability: mocks.getAiAvailability,
}));
vi.mock("@/lib/ai/service", async (importOriginal) => {
  const actual = await importOriginal<typeof ServiceModule>();
  return { ...actual, generateText: mocks.generateText };
});

import { suggestPiles, suggestPilesForOwner } from "@/lib/agents/piles";
import {
  AI_SORT_SYSTEM_PROMPT,
  buildSortPilesPrompt,
  parseAiPiles,
} from "@/lib/ai/sort-piles";
import { resetAiBudgetForTests } from "@/lib/ai/budget";

function bookmark(id: string, url: string, title: string) {
  return { id, type: "BOOKMARK", content: { url, title }, tags: [] };
}

const items = [
  bookmark("item-a", "https://cooking.example/pasta", "Easy pasta recipe"),
  bookmark("item-b", "https://trains.example/rome", "Night train to Rome"),
  bookmark("item-c", "https://food.example/curry", "Weeknight curry recipe"),
  bookmark("item-d", "https://hotels.example/lisbon", "Lisbon hotel deals"),
];

function sort(instruction: string | null = null) {
  return suggestPilesForOwner({
    userId: "u1",
    items,
    instruction,
    maxPiles: 8,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAiBudgetForTests();
  mocks.getAiAvailability.mockResolvedValue({ configured: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("suggestPilesForOwner", () => {
  it("uses valid AI piles and follows the instruction", async () => {
    mocks.generateText.mockResolvedValue(
      '```json\n{"piles":[{"title":"Travel","itemIds":["i2","i4"]},{"title":"Food","itemIds":["i1","i3"]}]}\n```',
    );

    const result = await sort("anything about travel together");

    expect(result).toEqual({
      method: "ai",
      notice: null,
      piles: [
        { title: "Travel", itemIds: ["item-b", "item-d"] },
        { title: "Food", itemIds: ["item-a", "item-c"] },
      ],
    });
    const call = mocks.generateText.mock.calls[0]![0];
    expect(call.system).toBe(AI_SORT_SYSTEM_PROMPT);
    expect(call.userId).toBe("u1");
    expect(call.prompt).toContain(
      "Owner's instruction: anything about travel together",
    );
    expect(call.prompt).toContain("i2: bookmark | Night train to Rome");
    expect(call.prompt).not.toContain("item-b");
  });

  it("falls back to word matching with a notice on an invalid answer", async () => {
    mocks.generateText.mockResolvedValue("Sure! Here are some piles: travel");

    const result = await sort();

    expect(result.method).toBe("words");
    expect(result.notice).toMatch(/could not be used/);
    expect(result.piles).toEqual(suggestPiles(items, { maxPiles: 8 }));
  });

  it("falls back when the answer has the wrong shape", async () => {
    mocks.generateText.mockResolvedValue('{"piles":[{"name":"x","ids":[]}]}');

    const result = await sort();

    expect(result.method).toBe("words");
    expect(result.notice).toMatch(/could not be used/);
  });

  it("drops item ids that are not on the canvas", async () => {
    mocks.generateText.mockResolvedValue(
      JSON.stringify([
        { title: "Travel", itemIds: ["i2", "i99", "other-board-item", "i4"] },
        { title: "Ghosts", itemIds: ["i42"] },
        { title: "Again", itemIds: ["i2"] },
      ]),
    );

    const result = await sort();

    expect(result).toEqual({
      method: "ai",
      notice: null,
      piles: [{ title: "Travel", itemIds: ["item-b", "item-d"] }],
    });
  });

  it("falls back when every id is unknown", async () => {
    mocks.generateText.mockResolvedValue(
      '{"piles":[{"title":"Ghosts","itemIds":["i42","nope"]}]}',
    );

    const result = await sort();

    expect(result.method).toBe("words");
    expect(result.notice).toMatch(/could not be used/);
  });

  it("falls back with a notice when the provider fails", async () => {
    mocks.generateText.mockRejectedValue(new Error("upstream"));

    const result = await sort();

    expect(result.method).toBe("words");
    expect(result.notice).toMatch(/could not sort/);
  });

  it("falls back with a notice when the AI budget is spent", async () => {
    vi.stubEnv("AI_DAILY_TOKEN_BUDGET", "10");

    const result = await sort();

    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(result.method).toBe("words");
    expect(result.notice).toMatch(/allowance/);
  });

  it("runs the word-matching sort unchanged without AI", async () => {
    mocks.getAiAvailability.mockResolvedValue({ configured: false });

    const result = await sort();

    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(result).toEqual({
      method: "words",
      notice: null,
      piles: suggestPiles(items, { maxPiles: 8 }),
    });
  });

  it("says the instruction was not used without AI", async () => {
    mocks.getAiAvailability.mockResolvedValue({ configured: false });

    const result = await sort("by project");

    expect(result.method).toBe("words");
    expect(result.notice).toMatch(/not set up/);
  });

  it("skips AI when the operator disabled it", async () => {
    vi.stubEnv("AI_ENABLED", "false");

    const result = await sort();

    expect(mocks.getAiAvailability).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(result.method).toBe("words");
  });
});

describe("buildSortPilesPrompt", () => {
  it("stops listing items at the prompt byte limit", () => {
    const many = Array.from({ length: 50 }, (_, index) =>
      bookmark(`id-${index}`, `https://x.example/${index}`, "x".repeat(200)),
    );

    const { prompt, aliases } = buildSortPilesPrompt(many, {
      maxPiles: 8,
      maxBytes: 2_000,
    });

    expect(Buffer.byteLength(prompt, "utf8")).toBeLessThanOrEqual(2_000);
    expect(aliases.size).toBeGreaterThan(0);
    expect(aliases.size).toBeLessThan(50);
  });

  it("honours AI_MAX_PROMPT_BYTES", () => {
    vi.stubEnv("AI_MAX_PROMPT_BYTES", "1500");
    const many = Array.from({ length: 50 }, (_, index) =>
      bookmark(`id-${index}`, `https://x.example/${index}`, "y".repeat(200)),
    );

    const { prompt } = buildSortPilesPrompt(many, { maxPiles: 8 });

    expect(Buffer.byteLength(prompt, "utf8")).toBeLessThanOrEqual(1_500);
  });
});

describe("parseAiPiles", () => {
  const aliases = new Map([
    ["i1", "a"],
    ["i2", "b"],
  ]);

  it("accepts a bare array and real ids from the list", () => {
    expect(
      parseAiPiles('[{"title":"Both","itemIds":["i1","b"]}]', aliases, 8),
    ).toEqual([{ title: "Both", itemIds: ["a", "b"] }]);
  });

  it("returns null for non-JSON", () => {
    expect(parseAiPiles("no piles today", aliases, 8)).toBeNull();
  });
});
