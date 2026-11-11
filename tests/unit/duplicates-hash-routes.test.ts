import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  existingFor,
  findExistingLinks,
  normalizeLinkUrl,
} from "@/lib/services/duplicates";

describe("hash-routed links (VAL-286)", () => {
  it("keeps #/ and #! routes in the duplicate key", () => {
    const one = normalizeLinkUrl("https://example.com/#/one");
    const two = normalizeLinkUrl("https://example.com/#/two");
    expect(one).not.toBe(two);
    expect(one).toBe("https://example.com#/one");
    expect(normalizeLinkUrl("https://example.com/app?b=2&a=1#!/a")).toBe(
      "https://example.com/app?a=1&b=2#!/a",
    );
    expect(normalizeLinkUrl("https://example.com/#!/a?utm_source=x")).toBe(
      "https://example.com#!/a?utm_source=x",
    );
  });

  it("still drops plain anchors", () => {
    expect(normalizeLinkUrl("https://example.com/page#section")).toBe(
      "https://example.com/page",
    );
    expect(normalizeLinkUrl("https://example.com/page#")).toBe(
      "https://example.com/page",
    );
  });

  it("does not report one hash route as a copy of another", async () => {
    const queryRaw = vi.fn(async () => [
      {
        id: "i1",
        canvasId: "c1",
        canvasName: "Inbox",
        url: "https://example.com/#/two",
        title: "Two",
      },
    ]);
    const db = { $queryRaw: queryRaw } as unknown as PrismaClient;
    const found = await findExistingLinks(db, "u1", [
      "https://example.com/#/one",
      "https://example.com/#/two",
    ]);
    expect(existingFor(found, "https://example.com/#/one")).toEqual([]);
    expect(
      existingFor(found, "https://example.com/#/two").map((e) => e.itemId),
    ).toEqual(["i1"]);
  });
});
