/**
 * TASK-020 — the per-canvas event counter is a BigInt on the Canvas row; a
 * canvas read through the shared client must stay JSON-serializable apart
 * from the revision the canvas routes already convert.
 */

import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { email: { startsWith: "rowjson-" } },
  });
  await prisma.$disconnect();
});

describe("Canvas rows", () => {
  it("do not carry the event counter unless it is selected", async () => {
    const owner = await prisma.user.create({
      data: { email: `rowjson-${Date.now()}@example.com` },
    });
    const created = await prisma.canvas.create({
      data: { name: "A", userId: owner.id },
    });
    const updated = await prisma.canvas.update({
      where: { id: created.id },
      data: { name: "B" },
    });
    for (const row of [created, updated]) {
      expect(row).not.toHaveProperty("eventSequence");
      expect(() =>
        JSON.stringify({ ...row, thumbnailRevision: "0" }),
      ).not.toThrow();
    }
    const selected = await prisma.canvas.findUniqueOrThrow({
      where: { id: created.id },
      select: { eventSequence: true },
    });
    expect(selected.eventSequence).toBe(0n);
  });
});
