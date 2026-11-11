import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

const session = vi.hoisted(() => ({ user: { id: "", email: "" } }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => session) }));

import { GET as search } from "@/app/api/v1/search/route";

afterAll(async () => {
  vi.restoreAllMocks();
  await prisma.$disconnect();
});

// The statement text, nested Prisma.sql fragments included.
function sqlOf(args: unknown[]): string {
  return JSON.stringify(args);
}

describe("global search", () => {
  it("returns the same page, totals and facets while scanning the match predicate twice", async () => {
    const tag = randomBytes(6).toString("hex");
    const word = `zebra${tag}`;
    const user = await prisma.user.create({
      data: { email: `search-${tag}@example.com` },
    });
    const stranger = await prisma.user.create({
      data: { email: `stranger-${tag}@example.com` },
    });
    session.user = { id: user.id, email: user.email };
    const mine = await prisma.canvas.create({
      data: { name: "Mine", userId: user.id },
    });
    const shared = await prisma.canvas.create({
      data: { name: "Shared", userId: stranger.id },
    });
    const hidden = await prisma.canvas.create({
      data: { name: "Hidden", userId: stranger.id },
    });
    await prisma.canvasShare.create({
      data: {
        canvasId: shared.id,
        email: user.email,
        recipientId: user.id,
        role: "VIEW",
      },
    });
    let z = 0;
    const item = (
      canvasId: string,
      type: "NOTE" | "BOOKMARK",
      content: object,
      tags: string[],
    ) =>
      prisma.canvasItem.create({
        data: {
          canvasId,
          type,
          positionX: 0,
          positionY: 0,
          width: 100,
          height: 100,
          zIndex: (z += 1),
          content,
          tags,
          createdById: user.id,
          updatedAt: new Date(Date.UTC(2026, 0, 1, 0, z)),
        },
      });
    await item(mine.id, "NOTE", { text: `first ${word} note` }, ["a", "b"]);
    await item(mine.id, "NOTE", { text: `second ${word}` }, ["a"]);
    await item(
      shared.id,
      "BOOKMARK",
      { url: `https://example.com/${word}`, title: "Link" },
      ["b"],
    );
    await item(hidden.id, "NOTE", { text: `hidden ${word}` }, ["a"]);
    await item(mine.id, "NOTE", { text: "unrelated" }, ["a"]);

    const queryRaw = vi.spyOn(prisma, "$queryRaw");
    const response = await search(
      new Request(`http://localhost/api/v1/search?q=${word}&limit=2`),
    );
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.totalResults).toBe(3);
    expect(body.pagination).toMatchObject({
      total: 3,
      limit: 2,
      offset: 0,
      hasMore: true,
    });
    expect(body.results).toHaveLength(2);
    expect(body.facets.types).toEqual([
      { value: "NOTE", count: 2 },
      { value: "BOOKMARK", count: 1 },
    ]);
    expect(body.facets.tags).toEqual([
      { value: "a", count: 2 },
      { value: "b", count: 2 },
    ]);

    const predicateScans = queryRaw.mock.calls.filter((call) =>
      sqlOf(call).includes("ILIKE"),
    ).length;
    queryRaw.mockRestore();
    // One statement for count and facets, one for the page.
    expect(predicateScans).toBe(2);
  });

  it("returns empty totals and facets when nothing matches", async () => {
    const response = await search(
      new Request(
        `http://localhost/api/v1/search?q=nomatch${randomBytes(6).toString("hex")}`,
      ),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.totalResults).toBe(0);
    expect(body.results).toEqual([]);
    expect(body.facets).toEqual({ types: [], tags: [] });
  });
});
