import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OutboxJob, PrismaClient } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => {
  const tx = {
    agentAction: { create: vi.fn(), update: vi.fn() },
    changeSet: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    changeRecord: { create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    canvasItem: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
  return {
    tx,
    changeSetFindFirst: vi.fn(),
    recordEvent: vi.fn(),
    lock: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    changeSet: { findFirst: mocks.changeSetFindFirst },
    $transaction: async (fn: (tx: typeof mocks.tx) => unknown) => fn(mocks.tx),
  },
}));
vi.mock("@/lib/canvas/mutation-lock", () => ({
  lockCanvasForMutation: mocks.lock,
}));
vi.mock("@/lib/collaboration/committed-events", () => ({
  recordCanvasItemEvent: mocks.recordEvent,
  recordCanvasItemEventsBatch: vi.fn(),
}));
vi.mock("@/lib/cache/canvas-cache", () => ({ invalidateCanvasCache: vi.fn() }));
vi.mock("@/lib/policy/capacity", () => ({
  assertCanvasItemCapacity: vi.fn(),
}));
vi.mock("@/lib/agents/piles", () => ({ suggestPilesForOwner: vi.fn() }));

import {
  RECAP_EMAIL_JOB,
  RECAP_USER_JOB,
  createWeeklyRecapEmailHandler,
  createWeeklyRecapSweepHandler,
  describeRecapSubject,
  recapWeekKey,
  recapWeekStart,
  staleLinkWhere,
  writeWeeklyRecap,
} from "@/lib/recap/weekly-recap";
import { ARCHIVE_OPERATION, archiveItems } from "@/lib/services/archive";
import { revertChangeSet } from "@/lib/agents/service-core";

const NOW = new Date("2026-11-05T12:00:00.000Z"); // a Thursday
const WEEK = new Date("2026-11-02T00:00:00.000Z");

function bookmark(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    canvasId: "canvas-a",
    type: "BOOKMARK",
    content: { url: `https://example.com/${id}`, title: `Link ${id}` },
    tags: [],
    version: 1,
    deletedAt: null,
    ...extra,
  };
}

/** A fake client holding at most one recap per (user, week), like the unique key. */
function fakeRecapStore(user: {
  id: string;
  staleLinkWeeks: number;
  weeklyRecapEmail: boolean;
}) {
  const recaps: Record<string, unknown>[] = [];
  const notifications: Record<string, unknown>[] = [];
  const jobs: Record<string, unknown>[] = [];
  const key = (row: { userId: unknown; weekStart: unknown }) =>
    `${row.userId}:${(row.weekStart as Date).toISOString()}`;
  const tx = {
    weeklyRecap: {
      createMany: vi.fn(async ({ data }: { data: Record<string, any>[] }) => {
        let count = 0;
        for (const row of data) {
          if (recaps.some((recap) => key(recap as any) === key(row as any)))
            continue;
          recaps.push({ id: `recap-${recaps.length + 1}`, ...row });
          count += 1;
        }
        return { count };
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => {
        const found = recaps.find(
          (recap) => key(recap as any) === key(where.userId_weekStart),
        );
        if (!found) throw new Error("missing");
        return found;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const found = recaps.find((recap) => recap.id === where.id)!;
        Object.assign(found, data);
        return found;
      }),
    },
    notification: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `note-${notifications.length + 1}`, ...data };
        notifications.push(row);
        return row;
      }),
    },
    outboxJob: {
      upsert: vi.fn(async ({ create }: any) => {
        if (!jobs.some((job) => job.dedupeKey === create.dedupeKey))
          jobs.push(create);
        return create;
      }),
    },
  };
  const client = {
    weeklyRecap: {
      findUnique: vi.fn(
        async ({ where }: any) =>
          recaps.find(
            (recap) => key(recap as any) === key(where.userId_weekStart),
          ) ?? null,
      ),
    },
    user: { findUnique: vi.fn(async () => user) },
    canvasItem: {
      count: vi.fn(async ({ where }: any) => (where.createdAt ? 2 : 3)),
      findMany: vi.fn(async ({ where }: any) =>
        where.createdAt
          ? [bookmark("new-1"), bookmark("new-2")]
          : [{ id: "old-1" }, { id: "old-2" }, { id: "old-3" }],
      ),
    },
    $transaction: async (fn: (store: typeof tx) => unknown) => fn(tx),
  };
  return {
    client: client as unknown as PrismaClient,
    recaps,
    notifications,
    jobs,
  };
}

const suggestPiles = vi.fn(async () => ({
  piles: [{ title: "Baking", itemIds: ["new-1", "new-2"] }],
  method: "words" as const,
  notice: null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  // revertChangeSet claims the change set and re-reads its records in the
  // transaction (TASK-142).
  mocks.tx.changeSet.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.changeRecord.findMany.mockImplementation(
    async () =>
      (await mocks.changeSetFindFirst.mock.results.at(-1)?.value)
        ?.changeRecords ?? [],
  );
  mocks.tx.canvasItem.findMany.mockResolvedValue([]);
});

describe("recap weeks", () => {
  it("anchors every day of an ISO week to its Monday (UTC)", () => {
    expect(recapWeekStart(NOW).toISOString()).toBe(WEEK.toISOString());
    expect(recapWeekKey(new Date("2026-11-08T23:59:59.000Z"))).toBe(
      "2026-11-02",
    );
    expect(recapWeekKey(new Date("2026-11-09T00:00:00.000Z"))).toBe(
      "2026-11-09",
    );
  });

  it("calls a link stale only when neither opened nor edited since the cutoff", () => {
    const cutoff = new Date("2026-09-24T12:00:00.000Z");
    expect(staleLinkWhere("user-1", cutoff)).toEqual({
      type: "BOOKMARK",
      deletedAt: null,
      canvas: { userId: "user-1", isTemplate: false },
      updatedAt: { lt: cutoff },
      OR: [{ lastOpenedAt: null }, { lastOpenedAt: { lt: cutoff } }],
    });
  });
});

describe("writing the weekly recap", () => {
  it("writes one recap and one in-app notification per week, however often it runs", async () => {
    const store = fakeRecapStore({
      id: "user-1",
      staleLinkWeeks: 6,
      weeklyRecapEmail: false,
    });
    const deps = { now: () => NOW, suggestPiles };

    const first = await writeWeeklyRecap(
      store.client,
      { userId: "user-1", weekStart: WEEK },
      deps,
    );
    const second = await writeWeeklyRecap(
      store.client,
      { userId: "user-1", weekStart: WEEK },
      deps,
    );

    expect(first).toBe("recap-1");
    expect(second).toBeNull();
    expect(store.recaps).toHaveLength(1);
    expect(store.recaps[0]).toMatchObject({
      savedCount: 2,
      staleCount: 3,
      staleWeeks: 6,
      staleItemIds: ["old-1", "old-2", "old-3"],
      suggestedPiles: [{ title: "Baking", itemIds: ["new-1", "new-2"] }],
      notificationId: "note-1",
      emailQueued: false,
    });
    expect(store.notifications).toHaveLength(1);
    expect(store.notifications[0]).toMatchObject({
      recipientId: "user-1",
      actorId: "user-1",
      type: "WEEKLY_RECAP",
      subject: "Your week: 2 links saved, 3 not opened in 6 weeks",
    });
    // In-app only by default: no email job.
    expect(store.jobs).toHaveLength(0);
  });

  it("sends nothing when a concurrent run already inserted the week's recap", async () => {
    const store = fakeRecapStore({
      id: "user-1",
      staleLinkWeeks: 6,
      weeklyRecapEmail: true,
    });
    // The early check misses, but the insert loses the race.
    store.recaps.push({ id: "recap-race", userId: "user-1", weekStart: WEEK });
    (store.client.weeklyRecap.findUnique as any).mockResolvedValueOnce(null);

    const result = await writeWeeklyRecap(
      store.client,
      { userId: "user-1", weekStart: WEEK },
      { now: () => NOW, suggestPiles },
    );

    expect(result).toBeNull();
    expect(store.notifications).toHaveLength(0);
    expect(store.jobs).toHaveLength(0);
  });

  it("queues exactly one email when the user opted in", async () => {
    const store = fakeRecapStore({
      id: "user-1",
      staleLinkWeeks: 4,
      weeklyRecapEmail: true,
    });
    await writeWeeklyRecap(
      store.client,
      { userId: "user-1", weekStart: WEEK },
      { now: () => NOW, suggestPiles },
    );
    await writeWeeklyRecap(
      store.client,
      { userId: "user-1", weekStart: WEEK },
      { now: () => NOW, suggestPiles },
    );

    expect(store.notifications).toHaveLength(1);
    expect(store.jobs).toEqual([
      expect.objectContaining({
        type: RECAP_EMAIL_JOB,
        payload: { recapId: "recap-1" },
        dedupeKey: `${RECAP_EMAIL_JOB}:recap-1`,
      }),
    ]);
    expect(store.recaps[0]).toMatchObject({ emailQueued: true, staleWeeks: 4 });
  });

  it("uses the user's stale threshold for the cutoff", async () => {
    const store = fakeRecapStore({
      id: "user-1",
      staleLinkWeeks: 10,
      weeklyRecapEmail: false,
    });
    await writeWeeklyRecap(
      store.client,
      { userId: "user-1", weekStart: WEEK },
      { now: () => NOW, suggestPiles },
    );
    const staleQuery = (store.client.canvasItem.count as any).mock.calls.find(
      ([args]: any) => !args.where.createdAt,
    )[0];
    expect(staleQuery.where.updatedAt.lt.toISOString()).toBe(
      new Date(NOW.getTime() - 70 * 86_400_000).toISOString(),
    );
  });

  it("describes a week with nothing stale without the stale part", () => {
    expect(
      describeRecapSubject({ savedCount: 1, staleCount: 0, staleWeeks: 6 }),
    ).toBe("Your week: 1 link saved");
  });
});

describe("the weekly sweep", () => {
  it("queues one keyed job per user for the week", async () => {
    const createMany = vi.fn(async () => ({ count: 2 }));
    const client = {
      user: {
        findMany: vi.fn(async () => [{ id: "u1" }, { id: "u2" }]),
      },
      outboxJob: { createMany },
    } as unknown as PrismaClient;

    await createWeeklyRecapSweepHandler(client)({
      id: "job-1",
      payload: { weekStart: "2026-11-02" },
    } as unknown as OutboxJob);

    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          type: RECAP_USER_JOB,
          payload: { userId: "u1", weekStart: "2026-11-02" },
          dedupeKey: `${RECAP_USER_JOB}:2026-11-02:u1`,
        }),
        expect.objectContaining({
          dedupeKey: `${RECAP_USER_JOB}:2026-11-02:u2`,
        }),
      ],
      skipDuplicates: true,
    });
  });
});

describe("the recap email", () => {
  function emailClient(weeklyRecapEmail: boolean) {
    return {
      weeklyRecap: {
        findUnique: vi.fn(async () => ({
          id: "recap-1",
          savedCount: 2,
          savedLinks: [
            { id: "new-1", title: "Sourdough <guide>", url: "https://x.test/" },
          ],
          suggestedPiles: [{ title: "Baking", itemIds: ["new-1", "new-2"] }],
          staleCount: 3,
          staleWeeks: 6,
          user: { email: "me@example.com", name: "Me", weeklyRecapEmail },
        })),
      },
    } as unknown as PrismaClient;
  }
  const job = {
    id: "job-email",
    payload: { recapId: "recap-1" },
  } as unknown as OutboxJob;

  it("is sent to a user who opted in, with links escaped", async () => {
    const send = vi.fn(async () => undefined);
    await createWeeklyRecapEmailHandler(emailClient(true), send)(job);
    expect(send).toHaveBeenCalledTimes(1);
    const [message] = send.mock.calls[0] as unknown as [
      { to: unknown; subject: string; text: string; html: string },
    ];
    expect(message.to).toEqual({ email: "me@example.com", name: "Me" });
    expect(message.subject).toBe("Your week in Memoria");
    expect(message.text).toContain("You saved 2 links this week.");
    expect(message.text).toContain("Baking (2)");
    expect(message.text).toContain("3 links have not been opened in 6 weeks");
    expect(message.html).toContain("Sourdough &lt;guide&gt;");
    expect(message.html).not.toContain("<guide>");
  });

  it("is skipped when the user turned email off after the recap was written", async () => {
    const send = vi.fn(async () => undefined);
    await createWeeklyRecapEmailHandler(emailClient(false), send)(job);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("archiving links and undoing it", () => {
  beforeEach(() => {
    mocks.tx.agentAction.create.mockResolvedValue({ id: "act-1" });
    mocks.tx.changeSet.create.mockResolvedValue({ id: "cs-1" });
  });

  it("moves owned links to the trash-backed archive in one change set", async () => {
    mocks.tx.canvasItem.findMany
      .mockResolvedValueOnce([
        { canvasId: "canvas-b" },
        { canvasId: "canvas-a" },
      ])
      .mockResolvedValueOnce([
        bookmark("i1"),
        bookmark("i2", { canvasId: "canvas-b" }),
      ]);
    mocks.tx.canvasItem.update.mockImplementation(async ({ where, data }) => ({
      ...bookmark(where.id),
      ...data,
      version: 2,
    }));

    const result = await archiveItems({
      actor: { userId: "user-1", agentProfileId: "prof-ask" },
      itemIds: ["i1", "i2", "i1"],
      summary: "Archive 2 links",
    });

    expect(result).toMatchObject({
      changeSetId: "cs-1",
      archivedItemIds: ["i1", "i2"],
      archivedItemCount: 2,
    });
    expect(mocks.tx.changeSet.create).toHaveBeenCalledTimes(1);
    // Locks in one sorted order across boards.
    expect(mocks.lock.mock.calls.map(([, id]) => id)).toEqual([
      "canvas-a",
      "canvas-b",
    ]);
    const update = mocks.tx.canvasItem.update.mock.calls[0]![0];
    expect(update.data).toMatchObject({
      deletedById: "user-1",
      version: { increment: 1 },
    });
    expect(update.data.deletedAt).toBeInstanceOf(Date);
    expect(update.data.archivedAt).toBe(update.data.deletedAt);
    // Content (and so an enriched summary) is never part of the write.
    expect(update.data).not.toHaveProperty("content");
    const operations = mocks.tx.changeRecord.create.mock.calls.map(
      ([call]) => call.data.operation,
    );
    expect(operations).toEqual([ARCHIVE_OPERATION, ARCHIVE_OPERATION]);
    expect(mocks.recordEvent).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({ itemId: "i2", operation: "deleted" }),
    );
  });

  it("refuses when nothing is left to archive, without writing", async () => {
    mocks.tx.canvasItem.findMany.mockResolvedValueOnce([]);
    await expect(
      archiveItems({
        actor: { userId: "user-1", agentProfileId: "prof-ask" },
        itemIds: ["gone"],
        summary: "Archive",
      }),
    ).rejects.toMatchObject({
      detail: "These items are already archived or gone.",
    });
    expect(mocks.tx.changeSet.create).not.toHaveBeenCalled();
  });

  it("undo puts every archived link back on its board", async () => {
    const archivedAt = new Date("2026-11-05T10:00:00.000Z");
    const archivedState = { deletedAt: archivedAt, archivedAt };
    mocks.changeSetFindFirst.mockResolvedValue({
      id: "cs-1",
      scopeType: "user",
      scopeId: "user-1",
      revertedAt: null,
      changeRecords: [
        {
          id: "cr-2",
          targetType: "CanvasItem",
          targetId: "i2",
          operation: ARCHIVE_OPERATION,
          before: bookmark("i2"),
          after: JSON.parse(JSON.stringify(bookmark("i2", archivedState))),
          reversible: true,
        },
        {
          id: "cr-1",
          targetType: "CanvasItem",
          targetId: "i1",
          operation: ARCHIVE_OPERATION,
          before: bookmark("i1"),
          after: JSON.parse(JSON.stringify(bookmark("i1", archivedState))),
          reversible: true,
        },
      ],
    });
    mocks.tx.agentAction.create.mockResolvedValue({ id: "act-rb" });
    mocks.tx.changeSet.create.mockResolvedValue({ id: "cs-rb" });
    mocks.tx.canvasItem.findFirst.mockResolvedValue({ canvasId: "canvas-a" });
    mocks.tx.canvasItem.findUnique
      .mockResolvedValueOnce(bookmark("i2", archivedState))
      // Already restored from Trash by hand: left alone.
      .mockResolvedValueOnce(bookmark("i1"));
    mocks.tx.canvasItem.update.mockImplementation(async ({ where, data }) => ({
      ...bookmark(where.id),
      ...data,
      version: 3,
    }));

    const result = await revertChangeSet({
      actor: { userId: "user-1", agentProfileId: "prof-ask" },
      changeSetId: "cs-1",
    });

    expect(result.revertedChangeSetId).toBe("cs-1");
    expect(mocks.tx.canvasItem.findFirst).toHaveBeenCalledWith({
      where: { id: "i2", canvas: { userId: "user-1" } },
      select: { canvasId: true },
    });
    expect(mocks.tx.canvasItem.update).toHaveBeenCalledTimes(1);
    expect(mocks.tx.canvasItem.update).toHaveBeenCalledWith({
      where: { id: "i2" },
      data: {
        deletedAt: null,
        deletedById: null,
        archivedAt: null,
        version: { increment: 1 },
        updatedById: "user-1",
      },
    });
    expect(mocks.recordEvent).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({ itemId: "i2", operation: "created" }),
    );
    expect(mocks.tx.changeSet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cs-1" },
        data: expect.objectContaining({ status: "REVERTED" }),
      }),
    );
  });
});
