import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

const authState = vi.hoisted(() => ({ userId: "", email: "" }));

vi.mock("@/lib/api/auth", () => ({
  requireAuth: async () => ({ ...authState }),
  requireCanvasAccess: async () => "OWNER",
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));

import { GET as listItems } from "@/app/api/v1/canvas-items/route";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("viewport item listing", () => {
  it("reads populated boards despite the generated search column", async () => {
    const user = await prisma.user.create({
      data: { email: `viewport-${Date.now()}@example.com` },
    });
    authState.userId = user.id;
    authState.email = user.email;
    const canvas = await prisma.canvas.create({
      data: { name: "Viewport", userId: user.id },
    });
    await prisma.canvasItem.create({
      data: {
        canvasId: canvas.id,
        type: "BOOKMARK",
        positionX: 10,
        positionY: 10,
        width: 360,
        height: 120,
        zIndex: 1,
        content: { url: "https://example.com", title: "Example" },
        createdById: user.id,
      },
    });

    const response = await listItems(
      new NextRequest(
        `http://localhost/api/v1/canvas-items?canvasId=${canvas.id}&minX=0&maxX=2000&minY=0&maxY=2000`,
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    const items = body.items ?? body.data?.items ?? body.data;
    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty("searchVector");
  });
});
