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
    data: { email: `revert-${label}-${Date.now()}@example.com` },
  });
  const [first, second] = await Promise.all([
    prisma.canvas.create({ data: { name: "A", userId: user.id } }),
    prisma.canvas.create({ data: { name: "B", userId: user.id } }),
  ]);
  const profile = await prisma.agentProfile.create({
    data: { userId: user.id, name: "Assistant" },
  });
  const actor = { userId: user.id, agentProfileId: profile.id };
  const note = (canvasId: string, index: number) =>
    prisma.canvasItem.create({
      data: {
        canvasId,
        type: "NOTE",
        positionX: index * 10,
        positionY: 0,
        width: 100,
        height: 100,
        zIndex: 0,
        content: { text: `<p>${index}</p>` },
        createdById: user.id,
        updatedById: user.id,
      },
    });
  return { user, canvases: [first!, second!], actor, note };
}

describe("revertChangeSet under concurrency", () => {
  it("reverts a change set at most once when two undos race", async () => {
    const { user, canvases, actor, note } = await seed("race");
    const items = await Promise.all([
      note(canvases[0].id, 1),
      note(canvases[1].id, 2),
    ]);
    const archived = await archiveItems({
      actor,
      itemIds: items.map((item) => item.id),
      summary: "Archive two",
    });

    const outcomes = await Promise.allSettled([
      revertChangeSet({ actor, changeSetId: archived.changeSetId }),
      revertChangeSet({ actor, changeSetId: archived.changeSetId }),
    ]);

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === "rejected") as
      PromiseRejectedResult | undefined;
    expect(rejected?.reason).toMatchObject({
      status: 403,
      detail: "This change set has already been reverted.",
    });
    const summary = `Rollback change set ${archived.changeSetId}`;
    expect(
      await prisma.changeSet.count({ where: { userId: user.id, summary } }),
    ).toBe(1);
    expect(
      await prisma.agentAction.count({ where: { userId: user.id, summary } }),
    ).toBe(1);
  });

  it("undoes a multi-board archive alongside a new archive without deadlocking", async () => {
    const { canvases, actor, note } = await seed("deadlock");
    const failures: unknown[] = [];
    for (let round = 0; round < 6; round += 1) {
      const undoItems = await Promise.all([
        note(canvases[0].id, round * 4),
        note(canvases[1].id, round * 4 + 1),
      ]);
      const archived = await archiveItems({
        actor,
        itemIds: undoItems.map((item) => item.id),
        summary: "Archive to undo",
      });
      const fresh = await Promise.all([
        note(canvases[0].id, round * 4 + 2),
        note(canvases[1].id, round * 4 + 3),
      ]);
      const outcomes = await Promise.allSettled([
        revertChangeSet({ actor, changeSetId: archived.changeSetId }),
        archiveItems({
          actor,
          itemIds: fresh.map((item) => item.id),
          summary: "Concurrent archive",
        }),
      ]);
      for (const outcome of outcomes) {
        if (outcome.status === "rejected") failures.push(outcome.reason);
      }
    }
    expect(failures).toEqual([]);
  }, 60_000);
});
