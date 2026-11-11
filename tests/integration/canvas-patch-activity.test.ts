import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

const authState = vi.hoisted(() => ({ userId: "", email: "" }));
vi.mock("@/lib/api/auth", () => ({
  requireAuth: async () => ({ ...authState }),
  requireCanvasOwnership: async () => undefined,
  requireCanvasAccess: async () => "OWNER",
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
const cache = vi.hoisted(() => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));
vi.mock("@/lib/cache/canvas-cache", () => cache);

import { PATCH as patchCanvas } from "@/app/api/v1/canvases/[canvasId]/route";

afterAll(async () => {
  await prisma.$disconnect();
});

async function patch(canvasId: string, body: unknown) {
  return patchCanvas(
    new NextRequest(`http://localhost/api/v1/canvases/${canvasId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ canvasId }) },
  );
}

describe("canvas PATCH activity", () => {
  it("logs CANVAS_UPDATED for a rename but not for a viewport-only save", async () => {
    const user = await prisma.user.create({
      data: { email: `patch-${randomBytes(6).toString("hex")}@example.com` },
    });
    authState.userId = user.id;
    authState.email = user.email;
    const canvas = await prisma.canvas.create({
      data: { name: "Board", userId: user.id },
    });
    const updates = () =>
      prisma.activity.count({
        where: { canvasId: canvas.id, type: "CANVAS_UPDATED" },
      });

    const viewport = await patch(canvas.id, {
      defaultViewport: { zoomLevel: 1.5, panX: -10, panY: 20 },
    });
    expect(viewport.status).toBe(200);
    const row = await prisma.canvas.findUniqueOrThrow({
      where: { id: canvas.id },
    });
    expect([row.zoomLevel, row.panX, row.panY]).toEqual([1.5, -10, 20]);
    expect(cache.invalidateCanvasCache).toHaveBeenCalledWith(canvas.id);
    expect(await updates()).toBe(0);

    const rename = await patch(canvas.id, { name: "Renamed" });
    expect(rename.status).toBe(200);
    expect(await updates()).toBe(1);
  });
});
