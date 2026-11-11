import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));

import { prisma } from "@/lib/db";
import { executeMcpTool } from "@/lib/agents/mcp";
import { ForbiddenError } from "@/lib/errors";

afterAll(async () => {
  await prisma.$disconnect();
});

async function seed() {
  const user = await prisma.user.create({
    data: { email: `mcp-revert-${randomBytes(6).toString("hex")}@example.com` },
  });
  const allowed = await prisma.canvas.create({
    data: { name: "Allowed", userId: user.id },
  });
  const other = await prisma.canvas.create({
    data: { name: "Other", userId: user.id },
  });
  const profile = await prisma.agentProfile.create({
    data: {
      userId: user.id,
      name: "Connected app",
      maxCapabilityRung: 4,
      enabledRungs: [0, 1, 2, 3, 4],
      allowedCanvasIds: [allowed.id],
    },
  });
  const context = {
    actorType: "integration" as const,
    userId: user.id,
    agentProfile: profile,
    integrationAccountId: null,
  };
  return { user, allowed, other, profile, context };
}

async function createdItemChangeSet(input: {
  userId: string;
  agentProfileId: string;
  canvasId: string;
  scopeType?: "canvas" | "user";
}) {
  const item = await prisma.canvasItem.create({
    data: {
      canvasId: input.canvasId,
      type: "NOTE",
      positionX: 0,
      positionY: 0,
      width: 200,
      height: 200,
      content: { text: "Agent note" },
      createdById: input.userId,
    },
  });
  const changeSet = await prisma.changeSet.create({
    data: {
      userId: input.userId,
      agentProfileId: input.agentProfileId,
      scopeType: input.scopeType ?? "canvas",
      scopeId: input.scopeType === "user" ? input.userId : input.canvasId,
      status: "COMPLETED",
      summary: "Create a note",
      changeRecords: {
        create: {
          targetType: "CanvasItem",
          targetId: item.id,
          operation: "CREATE",
          before: undefined,
          after: JSON.parse(JSON.stringify(item)),
          reversible: true,
        },
      },
    },
  });
  return { item, changeSet };
}

describe("MCP actions.revert_change_set canvas scope (PostgreSQL)", () => {
  it("refuses a change set on a canvas outside the profile's allowed canvases", async () => {
    const { user, other, profile, context } = await seed();
    const { item, changeSet } = await createdItemChangeSet({
      userId: user.id,
      agentProfileId: profile.id,
      canvasId: other.id,
    });

    await expect(
      executeMcpTool(context, "actions.revert_change_set", {
        changeSetId: changeSet.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const row = await prisma.changeSet.findUniqueOrThrow({
      where: { id: changeSet.id },
    });
    expect(row.revertedAt).toBeNull();
    const kept = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(kept.deletedAt).toBeNull();
  });

  it("refuses a user-scoped change set whose records name an outside canvas", async () => {
    const { user, other, profile, context } = await seed();
    const { changeSet } = await createdItemChangeSet({
      userId: user.id,
      agentProfileId: profile.id,
      canvasId: other.id,
      scopeType: "user",
    });

    await expect(
      executeMcpTool(context, "actions.revert_change_set", {
        changeSetId: changeSet.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const row = await prisma.changeSet.findUniqueOrThrow({
      where: { id: changeSet.id },
    });
    expect(row.revertedAt).toBeNull();
  });

  it("still reverts a change set on an allowed canvas", async () => {
    const { user, allowed, profile, context } = await seed();
    const { item, changeSet } = await createdItemChangeSet({
      userId: user.id,
      agentProfileId: profile.id,
      canvasId: allowed.id,
    });

    await executeMcpTool(context, "actions.revert_change_set", {
      changeSetId: changeSet.id,
    });

    const row = await prisma.changeSet.findUniqueOrThrow({
      where: { id: changeSet.id },
    });
    expect(row.revertedAt).toBeInstanceOf(Date);
    const removed = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(removed.deletedAt).toBeInstanceOf(Date);
  });
});
