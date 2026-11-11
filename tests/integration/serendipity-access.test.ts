import { randomBytes } from "crypto";
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { findSerendipitousItems } from "@/lib/ai/serendipity-service";

afterAll(async () => {
  await prisma.$disconnect();
});

function suffix() {
  return randomBytes(6).toString("hex");
}

async function note(canvasId: string, createdById: string, text: string) {
  await prisma.canvasItem.create({
    data: {
      canvasId,
      type: "NOTE",
      positionX: 0,
      positionY: 0,
      width: 200,
      height: 200,
      content: { text },
      createdById,
    },
  });
}

describe("findSerendipitousItems share authorization", () => {
  it("reads owned and recipient-bound canvases, never email-only shares", async () => {
    const caller = await prisma.user.create({
      data: { email: `seren-${suffix()}@example.com` },
    });
    const owner = await prisma.user.create({
      data: { email: `seren-owner-${suffix()}@example.com` },
    });
    const current = await prisma.canvas.create({
      data: { name: "Current", userId: caller.id },
    });
    const own = await prisma.canvas.create({
      data: { name: "Own", userId: caller.id },
    });
    const bound = await prisma.canvas.create({
      data: {
        name: "Bound",
        userId: owner.id,
        shares: {
          create: { email: caller.email, recipientId: caller.id },
        },
      },
    });
    const legacy = await prisma.canvas.create({
      data: {
        name: "Legacy",
        userId: owner.id,
        shares: { create: { email: caller.email, recipientId: null } },
      },
    });
    await note(own.id, caller.id, "own note");
    await note(bound.id, owner.id, "bound note");
    await note(legacy.id, owner.id, "legacy secret");

    const results = await findSerendipitousItems(caller.id, current.id, [], 10);
    const canvases = new Set(results.map((r) => r.item.canvasId));

    expect(canvases.has(own.id)).toBe(true);
    expect(canvases.has(bound.id)).toBe(true);
    expect(canvases.has(legacy.id)).toBe(false);
  });
});
