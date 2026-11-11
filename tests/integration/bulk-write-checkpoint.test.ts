import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));

import { prisma } from "@/lib/db";
import { createCanvasItemBatchWrite } from "@/lib/agents/service-core";
import { AGENT_CAPABILITY_RUNGS } from "@/lib/agents/constants";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("bulk write checkpoint (PostgreSQL)", () => {
  it("stores the canvas as it was before the bulk items were added", async () => {
    const user = await prisma.user.create({
      data: { email: `bulk-${randomBytes(6).toString("hex")}@example.com` },
    });
    const canvas = await prisma.canvas.create({
      data: { name: "Board", userId: user.id },
    });
    const existing = await prisma.canvasItem.create({
      data: {
        canvasId: canvas.id,
        type: "NOTE",
        positionX: 0,
        positionY: 0,
        width: 200,
        height: 200,
        content: { text: "Already here" },
        createdById: user.id,
        comments: { create: { userId: user.id, content: "A comment" } },
      },
    });
    const profile = await prisma.agentProfile.create({
      data: { userId: user.id, name: "Bulk agent" },
    });

    const result = await createCanvasItemBatchWrite({
      actor: { userId: user.id, agentProfileId: profile.id },
      canvasId: canvas.id,
      items: [
        {
          type: "NOTE",
          positionX: 300,
          positionY: 0,
          width: 200,
          height: 200,
          zIndex: 1,
          content: { text: "Bulk" },
        },
      ],
      summary: "Bulk add",
      rung: AGENT_CAPABILITY_RUNGS.BULK,
    });

    const checkpoints = await prisma.workspaceCheckpoint.findMany({
      where: { userId: user.id, scopeId: canvas.id },
    });
    expect(checkpoints).toHaveLength(1);
    expect(JSON.stringify(result)).toContain(checkpoints[0]!.id);
    const snapshot = checkpoints[0]!.snapshot as {
      canvas: { items: Array<{ id: string; comments: unknown[] }> };
      knowledgeEntities: unknown[];
    };
    expect(snapshot.canvas.items.map((item) => item.id)).toEqual([existing.id]);
    expect(snapshot.canvas.items[0]!.comments).toHaveLength(1);
    expect(snapshot.knowledgeEntities).toEqual([]);
  });
});
