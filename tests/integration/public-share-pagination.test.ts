import { randomBytes } from "crypto";
import { afterAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { GET as readPublicCanvas } from "@/app/api/v1/share/[token]/route";

afterAll(async () => {
  await prisma.$disconnect();
});

type Page = {
  items: Array<{ id: string }>;
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
};

async function read(token: string, query: string): Promise<Page> {
  const response = await readPublicCanvas(
    new NextRequest(`http://localhost/api/v1/share/${token}?${query}`),
    { params: Promise.resolve({ token }) },
  );
  expect(response.status).toBe(200);
  return (await response.json()) as Page;
}

describe("GET /api/v1/share/[token] cursor pagination", () => {
  it("reports hasMore and nextCursor on cursor pages until the last one", async () => {
    const suffix = randomBytes(6).toString("hex");
    const user = await prisma.user.create({
      data: { email: `share-pages-${suffix}@example.com` },
    });
    const token = `share-pages-${suffix}`;
    const canvas = await prisma.canvas.create({
      data: {
        name: "Pages",
        userId: user.id,
        isPublic: true,
        shareToken: token,
      },
    });
    await prisma.canvasItem.createMany({
      data: Array.from({ length: 130 }, (_, index) => ({
        canvasId: canvas.id,
        createdById: user.id,
        type: "NOTE" as const,
        positionX: index * 20,
        positionY: 0,
        width: 10,
        height: 10,
        zIndex: index,
        content: { text: `note-${index}` },
        tags: [],
      })),
    });

    const first = await read(token, "limit=50");
    expect([first.items.length, first.hasMore]).toEqual([50, true]);
    const second = await read(token, `limit=50&cursor=${first.nextCursor}`);
    expect([second.items.length, second.hasMore]).toEqual([50, true]);
    expect(second.nextCursor).not.toBeNull();
    const third = await read(token, `limit=50&cursor=${second.nextCursor}`);
    expect([third.items.length, third.hasMore]).toEqual([30, false]);
    expect(third.nextCursor).toBeNull();
    const ids = new Set(
      [...first.items, ...second.items, ...third.items].map((i) => i.id),
    );
    expect(ids.size).toBe(130);
  });
});
