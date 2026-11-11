import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));

import { revertChangeSet } from "@/lib/agents/service-core";

afterAll(async () => {
  await prisma.$disconnect();
});

async function agentBoard(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `undo-${label}-${randomBytes(4).toString("hex")}@example.com`,
    },
  });
  const profile = await prisma.agentProfile.create({
    data: { userId: user.id, name: "Agent" },
  });
  const board = await prisma.canvas.create({
    data: { name: `Agent board ${label}`, userId: user.id },
  });
  await prisma.agentProfile.update({
    where: { id: profile.id },
    data: { allowedCanvasIds: [board.id] },
  });
  const action = await prisma.agentAction.create({
    data: {
      userId: user.id,
      agentProfileId: profile.id,
      kind: "INGEST",
      rung: 1,
      status: "COMPLETED",
      summary: "Create board",
      requestFingerprint: randomBytes(8).toString("hex"),
    },
  });
  const changeSet = await prisma.changeSet.create({
    data: {
      userId: user.id,
      agentProfileId: profile.id,
      agentActionId: action.id,
      scopeType: "canvas",
      scopeId: board.id,
      status: "COMPLETED",
      summary: "Create board",
      changeRecords: {
        create: {
          targetType: "Canvas",
          targetId: board.id,
          operation: "CREATE",
          after: { id: board.id, grantedAgentProfileId: profile.id },
          reversible: true,
        },
      },
    },
  });
  const undo = () =>
    revertChangeSet({
      actor: { userId: user.id, agentProfileId: profile.id },
      changeSetId: changeSet.id,
    });
  return { user, board, undo };
}

async function boardExists(id: string) {
  return (await prisma.canvas.count({ where: { id } })) === 1;
}

describe("undoing an agent-created board keeps user content", () => {
  it("refuses when the board holds a trashed item", async () => {
    const { user, board, undo } = await agentBoard("trash");
    await prisma.canvasItem.create({
      data: {
        canvasId: board.id,
        type: "NOTE",
        positionX: 0,
        positionY: 0,
        width: 100,
        height: 100,
        content: { text: "restore me" },
        createdById: user.id,
        deletedAt: new Date(),
      },
    });
    await expect(undo()).rejects.toMatchObject({ status: 400 });
    expect(await boardExists(board.id)).toBe(true);
    expect(
      await prisma.canvasItem.count({ where: { canvasId: board.id } }),
    ).toBe(1);
  });

  it("refuses when the board has a saved (MANUAL) version", async () => {
    const { board, undo } = await agentBoard("version");
    await prisma.canvasVersion.create({
      data: { canvasId: board.id, name: "Saved", snapshot: {}, kind: "MANUAL" },
    });
    await expect(undo()).rejects.toMatchObject({ status: 400 });
    expect(await boardExists(board.id)).toBe(true);
  });

  it("refuses when the board has an embed", async () => {
    const { board, undo } = await agentBoard("embed");
    await prisma.canvasEmbed.create({
      data: {
        canvasId: board.id,
        tokenDigest: randomBytes(16).toString("hex"),
        allowedOrigins: ["https://example.com"],
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await expect(undo()).rejects.toMatchObject({ status: 400 });
    expect(await boardExists(board.id)).toBe(true);
  });

  it("still removes an untouched board (AUTO versions do not count)", async () => {
    const { board, undo } = await agentBoard("empty");
    await prisma.canvasVersion.create({
      data: { canvasId: board.id, name: "Auto", snapshot: {}, kind: "AUTO" },
    });
    await undo();
    expect(await boardExists(board.id)).toBe(false);
  });
});
