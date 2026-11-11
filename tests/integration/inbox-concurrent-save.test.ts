import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));

import { saveToInbox } from "@/lib/agents/inbox";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("saveToInbox under concurrency", () => {
  it("gives concurrent saves to one Inbox different slots", async () => {
    const user = await prisma.user.create({
      data: { email: `inbox-race-${Date.now()}@example.com` },
    });
    const inbox = await prisma.canvas.create({
      data: { name: "Inbox", userId: user.id },
    });
    const profile = await prisma.agentProfile.create({
      data: {
        userId: user.id,
        name: "Connected app",
        allowedCanvasIds: [inbox.id],
      },
    });
    const actor = { userId: user.id, agentProfileId: profile.id };

    await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        saveToInbox({
          actor,
          agentProfile: profile,
          data: { text: `Note ${index}` },
        }),
      ),
    );

    const items = await prisma.canvasItem.findMany({
      where: { canvasId: inbox.id, deletedAt: null },
      select: { positionX: true, positionY: true },
    });
    expect(items).toHaveLength(4);
    const slots = new Set(
      items.map((item) => `${item.positionX},${item.positionY}`),
    );
    expect(slots.size).toBe(4);
  });
});
