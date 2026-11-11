import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));

import { revertChangeSet } from "@/lib/agents/service-core";
import { archiveItems } from "@/lib/services/archive";

afterAll(async () => {
  await prisma.$disconnect();
});

async function seed(label: string) {
  const user = await prisma.user.create({
    data: { email: `archive-undo-${label}-${Date.now()}@example.com` },
  });
  const canvas = await prisma.canvas.create({
    data: { name: "Board", userId: user.id },
  });
  const profile = await prisma.agentProfile.create({
    data: { userId: user.id, name: "Assistant" },
  });
  const item = await prisma.canvasItem.create({
    data: {
      canvasId: canvas.id,
      type: "NOTE",
      positionX: 0,
      positionY: 0,
      width: 100,
      height: 100,
      zIndex: 0,
      content: { text: "<p>note</p>" },
      createdById: user.id,
      updatedById: user.id,
    },
  });
  return { actor: { userId: user.id, agentProfileId: profile.id }, item };
}

/** What the Trash restore does: clear the deletion and the archive mark. */
async function restoreFromTrash(itemId: string) {
  await prisma.canvasItem.update({
    where: { id: itemId },
    data: {
      deletedAt: null,
      deletedById: null,
      archivedAt: null,
      version: { increment: 1 },
    },
  });
}

describe("undoing an archive", () => {
  it("restores an item nobody touched since", async () => {
    const { actor, item } = await seed("plain");
    const archived = await archiveItems({
      actor,
      itemIds: [item.id],
      summary: "Archive",
    });

    await revertChangeSet({ actor, changeSetId: archived.changeSetId });

    const row = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(row.deletedAt).toBeNull();
    expect(row.archivedAt).toBeNull();
  });

  it("keeps a later deliberate delete", async () => {
    const { actor, item } = await seed("deleted");
    const archived = await archiveItems({
      actor,
      itemIds: [item.id],
      summary: "Archive",
    });
    await restoreFromTrash(item.id);
    await prisma.canvasItem.update({
      where: { id: item.id },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });

    await revertChangeSet({ actor, changeSetId: archived.changeSetId });

    const row = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(row.deletedAt).not.toBeNull();
  });

  it("keeps a later second archive", async () => {
    const { actor, item } = await seed("rearchived");
    const first = await archiveItems({
      actor,
      itemIds: [item.id],
      summary: "Archive A",
    });
    await restoreFromTrash(item.id);
    await archiveItems({ actor, itemIds: [item.id], summary: "Archive B" });

    await revertChangeSet({ actor, changeSetId: first.changeSetId });

    const row = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(row.deletedAt).not.toBeNull();
    expect(row.archivedAt).not.toBeNull();
  });
});
