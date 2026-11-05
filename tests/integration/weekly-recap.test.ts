import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { OutboxJob } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));

vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));

import { prisma } from "@/lib/db";
import {
  RECAP_EMAIL_JOB,
  RECAP_SWEEP_JOB,
  RECAP_USER_JOB,
  createWeeklyRecapHandler,
  createWeeklyRecapSweepHandler,
  enqueueWeeklyRecapSweep,
  recapWeekKey,
  recapWeekStart,
} from "@/lib/recap/weekly-recap";
import { archiveRecapStaleLinks } from "@/lib/recap/archive-stale";
import { revertChangeSet } from "@/lib/agents/service-core";
import { createTrashRetentionHandler } from "@/lib/retention/outbox-handler";
import { POST as openedRoute } from "@/app/api/v1/items/[itemId]/opened/route";

afterAll(async () => {
  await prisma.$disconnect();
});

const WEEKS = 7 * 86_400_000;
const suggestPiles = vi.fn(async () => ({
  piles: [] as { title: string; itemIds: string[] }[],
  method: "words" as const,
  notice: null,
}));

async function seedUser(weeklyRecapEmail: boolean) {
  const user = await prisma.user.create({
    data: {
      email: `recap-${randomBytes(6).toString("hex")}@example.com`,
      weeklyRecapEmail,
    },
  });
  const canvas = await prisma.canvas.create({
    data: { name: "Links", userId: user.id },
  });
  const link = (id: string, extra: Record<string, unknown> = {}) =>
    prisma.canvasItem.create({
      data: {
        canvasId: canvas.id,
        type: "BOOKMARK",
        positionX: 0,
        positionY: 0,
        width: 200,
        height: 100,
        content: {
          url: `https://example.com/${id}`,
          title: `Link ${id}`,
          summary: `What ${id} is about.`,
        },
        createdById: user.id,
        ...extra,
      },
    });
  const fresh = await link("fresh");
  const old = await link("old");
  const oldOpened = await link("old-opened");
  const oldEdited = await link("old-edited");
  // Saved ten weeks ago; only `old` has been neither opened nor edited since.
  const longAgo = new Date(Date.now() - 10 * WEEKS);
  await prisma.$executeRaw`
    UPDATE "CanvasItem" SET "createdAt" = ${longAgo}, "updatedAt" = ${longAgo}
    WHERE "id" IN (${old.id}, ${oldOpened.id}, ${oldEdited.id})
  `;
  await prisma.$executeRaw`
    UPDATE "CanvasItem" SET "updatedAt" = NOW() WHERE "id" = ${oldEdited.id}
  `;
  await prisma.itemEnrichment.create({
    data: { itemId: old.id, userId: user.id, status: "DONE" },
  });
  return { user, canvas, fresh, old, oldOpened, oldEdited };
}

function job(type: string, payload: Record<string, unknown>): OutboxJob {
  return {
    id: `job-${randomBytes(4).toString("hex")}`,
    type,
    payload,
  } as unknown as OutboxJob;
}

describe("weekly recap (PostgreSQL)", () => {
  it("records a link open without touching its edit time or version", async () => {
    const { user, oldOpened } = await seedUser(false);
    mocks.auth.mockResolvedValue({ user: { id: user.id, email: user.email } });
    const before = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: oldOpened.id },
    });

    const request = new Request(
      `http://localhost/api/v1/items/${oldOpened.id}/opened`,
      { method: "POST" },
    ) as unknown as NextRequest;
    const response = await openedRoute(request, {
      params: Promise.resolve({ itemId: oldOpened.id }),
    });
    expect(response.status).toBe(204);

    const after = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: oldOpened.id },
    });
    expect(after.lastOpenedAt).toBeInstanceOf(Date);
    expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
    expect(after.version).toBe(before.version);

    // Someone else cannot mark it opened.
    mocks.auth.mockResolvedValue({
      user: { id: "someone-else", email: "x@example.com" },
    });
    const foreign = await openedRoute(request, {
      params: Promise.resolve({ itemId: oldOpened.id }),
    });
    expect(foreign.status).toBe(404);
  });

  it("writes one recap per user per week however often the job runs", async () => {
    const quiet = await seedUser(false);
    const emailed = await seedUser(true);
    // `old-opened` was opened this week, so it is not stale.
    for (const seeded of [quiet, emailed]) {
      await prisma.$executeRaw`
        UPDATE "CanvasItem" SET "lastOpenedAt" = NOW() WHERE "id" = ${seeded.oldOpened.id}
      `;
    }

    const now = new Date();
    const weekKey = recapWeekKey(now);
    await enqueueWeeklyRecapSweep(prisma, now);
    await enqueueWeeklyRecapSweep(prisma, now);
    expect(
      await prisma.outboxJob.count({
        where: { dedupeKey: `${RECAP_SWEEP_JOB}:${weekKey}` },
      }),
    ).toBe(1);

    const sweep = createWeeklyRecapSweepHandler(prisma);
    await sweep(job(RECAP_SWEEP_JOB, { weekStart: weekKey }));
    await sweep(job(RECAP_SWEEP_JOB, { weekStart: weekKey }));
    const userJobs = await prisma.outboxJob.findMany({
      where: {
        type: RECAP_USER_JOB,
        dedupeKey: {
          in: [quiet, emailed].map(
            (seeded) => `${RECAP_USER_JOB}:${weekKey}:${seeded.user.id}`,
          ),
        },
      },
    });
    expect(userJobs).toHaveLength(2);

    const handler = createWeeklyRecapHandler(prisma, { suggestPiles });
    // Run every job twice, and race two runs of one, as retries would.
    for (const userJob of userJobs) await handler(userJob);
    await Promise.all(userJobs.map((userJob) => handler(userJob)));

    for (const seeded of [quiet, emailed]) {
      const recaps = await prisma.weeklyRecap.findMany({
        where: { userId: seeded.user.id },
      });
      expect(recaps).toHaveLength(1);
      expect(recaps[0]).toMatchObject({
        weekStart: recapWeekStart(now),
        savedCount: 1,
        staleWeeks: 6,
        staleCount: 1,
        staleItemIds: [seeded.old.id],
      });
      expect(
        await prisma.notification.count({
          where: { recipientId: seeded.user.id, type: "WEEKLY_RECAP" },
        }),
      ).toBe(1);
    }

    const emailJobs = await prisma.outboxJob.findMany({
      where: { type: RECAP_EMAIL_JOB },
    });
    const recapIds = (
      await prisma.weeklyRecap.findMany({
        where: { userId: { in: [quiet.user.id, emailed.user.id] } },
        select: { id: true, userId: true },
      })
    ).reduce<Record<string, string>>(
      (byUser, recap) => ({ ...byUser, [recap.userId]: recap.id }),
      {},
    );
    const mine = emailJobs.filter((emailJob) =>
      Object.values(recapIds).includes(
        (emailJob.payload as { recapId: string }).recapId,
      ),
    );
    // Default is in-app only; the opted-in user gets exactly one email.
    expect(mine).toHaveLength(1);
    expect(mine[0]!.payload).toEqual({ recapId: recapIds[emailed.user.id] });
  });

  it("archives stale links in one undoable change set and never sweeps them", async () => {
    const seeded = await seedUser(false);
    await prisma.$executeRaw`
      UPDATE "CanvasItem" SET "lastOpenedAt" = NOW() WHERE "id" = ${seeded.oldOpened.id}
    `;
    const now = new Date();
    await createWeeklyRecapHandler(prisma, { suggestPiles })(
      job(RECAP_USER_JOB, {
        userId: seeded.user.id,
        weekStart: recapWeekKey(now),
      }),
    );
    const recap = await prisma.weeklyRecap.findFirstOrThrow({
      where: { userId: seeded.user.id },
    });

    const result = await archiveRecapStaleLinks({
      userId: seeded.user.id,
      recapId: recap.id,
    });
    expect(result.archivedItemIds).toEqual([seeded.old.id]);
    await expect(
      archiveRecapStaleLinks({ userId: seeded.user.id, recapId: recap.id }),
    ).rejects.toMatchObject({ status: 409 });

    const archived = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: seeded.old.id },
      include: { enrichment: true },
    });
    expect(archived.deletedAt).toBeInstanceOf(Date);
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(archived.content).toMatchObject({ summary: "What old is about." });
    expect(archived.enrichment).not.toBeNull();
    const changeRecords = await prisma.changeRecord.findMany({
      where: { changeSetId: result.changeSetId },
    });
    expect(changeRecords.map((record) => record.operation)).toEqual([
      "ARCHIVE",
    ]);

    // Long past the trash retention window, the archived link is still kept.
    const longAgo = new Date(Date.now() - 400 * 86_400_000);
    await prisma.$executeRaw`
      UPDATE "CanvasItem" SET "deletedAt" = ${longAgo} WHERE "id" = ${seeded.old.id}
    `;
    await createTrashRetentionHandler(prisma)(job("retention.trash", {}));
    expect(
      await prisma.canvasItem.count({ where: { id: seeded.old.id } }),
    ).toBe(1);

    const profile = await prisma.agentProfile.findFirstOrThrow({
      where: { userId: seeded.user.id, name: "Memoria assistant" },
    });
    await revertChangeSet({
      actor: { userId: seeded.user.id, agentProfileId: profile.id },
      changeSetId: result.changeSetId,
    });
    const restored = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: seeded.old.id },
    });
    expect(restored.deletedAt).toBeNull();
    expect(restored.archivedAt).toBeNull();
    expect(restored.canvasId).toBe(seeded.canvas.id);
    expect(restored.content).toMatchObject({ summary: "What old is about." });
  });
});
