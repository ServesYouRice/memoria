/**
 * IMP-046 — version history against real PostgreSQL: the automatic snapshot
 * job and the retention policy must be idempotent, and the routes must keep
 * viewers out of restore.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import type * as AuthModule from "@/lib/api/auth";

const authState = vi.hoisted(() => ({ userId: "", email: "" }));

// Routes authorize with the real `requireCanvasAccess`; only the session
// lookup is replaced.
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  requireAuth: async () => ({ ...authState }),
}));
vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));

import { prisma } from "@/lib/db";
import { claimOutboxJobs } from "@/lib/outbox/repository";
import { createVersionRetentionHandler } from "@/lib/retention/outbox-handler";
import {
  createAutoRetentionHandler,
  createAutoSnapshotHandler,
  deleteExpiredAutoVersions,
  findAutoSnapshotCandidates,
  runAutoSnapshotSweep,
  snapshotCanvasIfChanged,
} from "@/lib/versions/outbox-handler";
import {
  AUTO_RETENTION_JOB,
  AUTO_SNAPSHOT_INTERVAL_MS,
  AUTO_SNAPSHOT_JOB,
} from "@/lib/versions/policy";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";
import { GET as cronGet } from "@/app/api/cron/version-history/route";
import {
  GET as listVersions,
  POST as createVersion,
} from "@/app/api/v1/canvases/[canvasId]/versions/route";
import { GET as readVersion } from "@/app/api/v1/canvases/[canvasId]/versions/[versionId]/route";
import { POST as restoreVersion } from "@/app/api/v1/canvases/[canvasId]/versions/[versionId]/restore/route";

let counter = 0;
const MINUTE = 60_000;

async function makeUser(label: string) {
  counter += 1;
  return prisma.user.create({
    data: { email: `history-${label}-${Date.now()}-${counter}@example.com` },
  });
}

async function makeCanvas(
  ownerId: string,
  options: { items?: number; itemUpdatedAt?: Date } = {},
) {
  const canvas = await prisma.canvas.create({
    data: { name: "History", userId: ownerId },
  });
  for (let index = 0; index < (options.items ?? 2); index += 1) {
    await prisma.canvasItem.create({
      data: {
        canvasId: canvas.id,
        type: "SHAPE",
        positionX: index * 50,
        positionY: 0,
        width: 40,
        height: 40,
        content: { shapeType: "star" },
        createdById: ownerId,
        ...(options.itemUpdatedAt ? { updatedAt: options.itemUpdatedAt } : {}),
      },
    });
  }
  return canvas;
}

function versionsOf(canvasId: string) {
  return prisma.canvasVersion.findMany({
    where: { canvasId },
    orderBy: { createdAt: "asc" },
  });
}

function request(url: string, method = "GET", body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(async () => {
  // The sweep looks at every canvas, so start from an empty slate.
  await prisma.outboxJob.deleteMany();
  await prisma.canvas.deleteMany();
  authState.userId = "";
  authState.email = "";
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("automatic snapshots", () => {
  it("snapshots a changed canvas once, however often the job runs", async () => {
    const owner = await makeUser("owner");
    const canvas = await makeCanvas(owner.id);
    const now = new Date();

    const outcomes = await Promise.all(
      Array.from({ length: 4 }, () =>
        snapshotCanvasIfChanged(prisma, canvas.id, { now }),
      ),
    );
    expect(outcomes.filter((outcome) => outcome === "created")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "recent")).toHaveLength(3);

    const [version] = await versionsOf(canvas.id);
    expect(version).toMatchObject({ kind: "AUTO", createdById: null });
    expect(version.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(version.yjsState).not.toBeNull();
    expect((version.snapshot as { items: unknown[] }).items).toHaveLength(2);

    // Past the interval but unchanged: still exactly one version.
    const later = new Date(now.getTime() + AUTO_SNAPSHOT_INTERVAL_MS + MINUTE);
    expect(
      await snapshotCanvasIfChanged(prisma, canvas.id, { now: later }),
    ).toBe("unchanged");
    expect(await versionsOf(canvas.id)).toHaveLength(1);
  });

  it("waits out the interval, then snapshots a real change", async () => {
    const owner = await makeUser("owner");
    const canvas = await makeCanvas(owner.id);
    const now = new Date();
    await snapshotCanvasIfChanged(prisma, canvas.id, { now });

    const item = await prisma.canvasItem.findFirstOrThrow({
      where: { canvasId: canvas.id },
    });
    await prisma.canvasItem.update({
      where: { id: item.id },
      data: { positionX: 999, version: { increment: 1 } },
    });
    expect(
      await snapshotCanvasIfChanged(prisma, canvas.id, {
        now: new Date(now.getTime() + AUTO_SNAPSHOT_INTERVAL_MS - MINUTE),
      }),
    ).toBe("recent");

    const due = new Date(now.getTime() + AUTO_SNAPSHOT_INTERVAL_MS + MINUTE);
    expect(await snapshotCanvasIfChanged(prisma, canvas.id, { now: due })).toBe(
      "created",
    );
    expect(await snapshotCanvasIfChanged(prisma, canvas.id, { now: due })).toBe(
      "recent",
    );
    const versions = await versionsOf(canvas.id);
    expect(versions).toHaveLength(2);
    expect(versions[0].contentHash).not.toBe(versions[1].contentHash);
  });

  it("does not repeat a manual version with the same content", async () => {
    const owner = await makeUser("owner");
    const canvas = await makeCanvas(owner.id);
    authState.userId = owner.id;
    const created = await createVersion(
      request(
        `http://localhost/api/v1/canvases/${canvas.id}/versions`,
        "POST",
        {
          name: "Checkpoint",
        },
      ),
      { params: Promise.resolve({ canvasId: canvas.id }) },
    );
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      kind: "MANUAL",
      createdBy: { id: owner.id },
    });

    const later = new Date(Date.now() + 3 * AUTO_SNAPSHOT_INTERVAL_MS);
    expect(
      await snapshotCanvasIfChanged(prisma, canvas.id, { now: later }),
    ).toBe("unchanged");
    expect(await versionsOf(canvas.id)).toHaveLength(1);
  });

  it("skips canvases with nothing on them", async () => {
    const owner = await makeUser("owner");
    const canvas = await makeCanvas(owner.id, { items: 0 });
    expect(await snapshotCanvasIfChanged(prisma, canvas.id)).toBe("empty");
    expect(await versionsOf(canvas.id)).toHaveLength(0);
    expect(await snapshotCanvasIfChanged(prisma, "missing-canvas")).toBe(
      "missing",
    );
  });

  it("only considers recently edited canvases whose latest version is old enough", async () => {
    const owner = await makeUser("owner");
    const now = new Date();
    const active = await makeCanvas(owner.id);
    await makeCanvas(owner.id, {
      itemUpdatedAt: new Date(now.getTime() - 3 * 86_400_000),
    });
    await makeCanvas(owner.id, { items: 0 });
    expect(await findAutoSnapshotCandidates(prisma, { now })).toEqual([
      active.id,
    ]);

    // Fresh version: not a candidate. After the interval and an edit: is again.
    await snapshotCanvasIfChanged(prisma, active.id, { now });
    expect(await findAutoSnapshotCandidates(prisma, { now })).toEqual([]);
    await prisma.canvasItem.updateMany({
      where: { canvasId: active.id },
      data: { positionY: 77 },
    });
    expect(
      await findAutoSnapshotCandidates(prisma, {
        now: new Date(now.getTime() + AUTO_SNAPSHOT_INTERVAL_MS - MINUTE),
      }),
    ).toEqual([]);
    expect(
      await findAutoSnapshotCandidates(prisma, {
        now: new Date(now.getTime() + AUTO_SNAPSHOT_INTERVAL_MS + MINUTE),
      }),
    ).toEqual([active.id]);
  });

  it("sweeps repeatedly without duplicating and survives a failing canvas", async () => {
    const owner = await makeUser("owner");
    const canvases = await Promise.all([
      makeCanvas(owner.id),
      makeCanvas(owner.id),
      makeCanvas(owner.id),
    ]);
    const now = new Date();
    const first = await runAutoSnapshotSweep(prisma, { now });
    expect(first).toMatchObject({ candidates: 3, created: 3, failed: 0 });
    const second = await runAutoSnapshotSweep(prisma, { now });
    expect(second).toMatchObject({ candidates: 0, created: 0 });
    const third = await runAutoSnapshotSweep(prisma, {
      now: new Date(now.getTime() + 2 * AUTO_SNAPSHOT_INTERVAL_MS),
    });
    expect(third.created).toBe(0);
    for (const canvas of canvases) {
      expect(await versionsOf(canvas.id)).toHaveLength(1);
    }

    // A canvas over the snapshot limit fails alone; the others still run.
    const big = await makeCanvas(owner.id, { items: 0 });
    await prisma.canvasItem.createMany({
      data: Array.from(
        { length: LAUNCH_LIMITS.itemsPerCanvas + 1 },
        (_, i) => ({
          canvasId: big.id,
          type: "SHAPE" as const,
          positionX: i,
          positionY: 0,
          width: 1,
          height: 1,
          content: { shapeType: "star" },
          createdById: owner.id,
        }),
      ),
    });
    const good = await makeCanvas(owner.id);
    const mixed = await runAutoSnapshotSweep(prisma, {
      now: new Date(now.getTime() + 3 * AUTO_SNAPSHOT_INTERVAL_MS),
    });
    expect(mixed).toMatchObject({ created: 1, failed: 1 });
    expect(await versionsOf(good.id)).toHaveLength(1);
    expect(await versionsOf(big.id)).toHaveLength(0);
  });

  it("runs through the outbox handler and the scheduler's cron route", async () => {
    const owner = await makeUser("owner");
    const canvas = await makeCanvas(owner.id);
    process.env.CRON_SECRET = "version-history-cron-secret-12345";
    const call = () =>
      cronGet(
        new NextRequest("http://localhost/api/cron/version-history", {
          headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
        }),
      );
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    const unauthorized = await cronGet(
      new NextRequest("http://localhost/api/cron/version-history"),
    );
    expect(unauthorized.status).toBe(401);

    // Repeated scheduler calls inside one bucket queue one job per type.
    const jobs = await prisma.outboxJob.findMany({
      where: { type: { in: [AUTO_SNAPSHOT_JOB, AUTO_RETENTION_JOB] } },
    });
    expect(jobs.map((job) => job.type).sort()).toEqual([
      AUTO_RETENTION_JOB,
      AUTO_SNAPSHOT_JOB,
    ]);

    const claimed = await claimOutboxJobs(prisma, {
      owner: "test",
      limit: 10,
      leaseMs: 30_000,
      types: [AUTO_SNAPSHOT_JOB],
    });
    expect(claimed).toHaveLength(1);
    const context = {
      signal: new AbortController().signal,
      deliveryId: "test",
      deadlineAt: new Date(Date.now() + 15_000),
    };
    const handler = createAutoSnapshotHandler(prisma);
    await handler(claimed[0], context);
    await handler(claimed[0], context);
    expect(await versionsOf(canvas.id)).toHaveLength(1);
  });
});

describe("automatic version retention", () => {
  const now = new Date("2026-06-15T12:30:00.000Z");

  async function seed(canvasId: string, kind: "AUTO" | "MANUAL", iso: string) {
    const version = await prisma.canvasVersion.create({
      data: {
        canvasId,
        kind,
        name: iso,
        snapshot: {},
        createdAt: new Date(iso),
      },
    });
    return version.id;
  }

  it("keeps all of the last day, then hourly, then daily, and never deletes manual versions", async () => {
    const owner = await makeUser("owner");
    const canvas = await makeCanvas(owner.id);
    const other = await makeCanvas(owner.id);

    const kept = [
      // Last 24 hours: everything stays, even within one hour.
      "2026-06-15T10:00:00Z",
      "2026-06-15T10:10:00Z",
      "2026-06-15T11:55:00Z",
      "2026-06-14T12:40:00Z",
      // 24h..7d: earliest per clock hour (12:10 straddles the 24h cut-off).
      "2026-06-14T12:10:00Z",
      "2026-06-13T08:05:00Z",
      "2026-06-13T09:15:00Z",
      "2026-06-12T08:10:00Z",
      // 7d..30d: earliest per UTC day.
      "2026-06-05T03:10:00Z",
      "2026-06-04T22:00:00Z",
      "2026-05-20T01:00:00Z",
    ];
    const doomed = [
      "2026-06-14T12:20:00Z",
      "2026-06-13T08:25:00Z",
      "2026-06-13T08:55:00Z",
      "2026-06-05T03:40:00Z",
      "2026-06-05T15:00:00Z",
      "2026-06-04T23:30:00Z",
      // Older than 30 days.
      "2026-05-10T00:00:00Z",
      "2026-04-01T09:00:00Z",
    ];
    const keptIds = await Promise.all(
      kept.map((iso) => seed(canvas.id, "AUTO", iso)),
    );
    const doomedIds = await Promise.all(
      doomed.map((iso) => seed(canvas.id, "AUTO", iso)),
    );
    // Manual versions share buckets with automatic ones and are far too old.
    const manualIds = await Promise.all(
      [
        "2026-06-13T08:30:00Z",
        "2026-06-05T15:30:00Z",
        "2026-03-01T00:00:00Z",
      ].map((iso) => seed(canvas.id, "MANUAL", iso)),
    );
    // Buckets are per canvas: the same hour on another canvas is its own.
    const otherId = await seed(other.id, "AUTO", "2026-06-13T08:45:00Z");

    expect(await deleteExpiredAutoVersions(prisma, { now, batch: 3 })).toBe(
      doomed.length,
    );
    const remaining = new Set(
      (await prisma.canvasVersion.findMany({ select: { id: true } })).map(
        (row) => row.id,
      ),
    );
    for (const id of [...keptIds, ...manualIds, otherId]) {
      expect(remaining.has(id)).toBe(true);
    }
    for (const id of doomedIds) expect(remaining.has(id)).toBe(false);

    // Idempotent: nothing more to do, and a handler run agrees.
    expect(await deleteExpiredAutoVersions(prisma, { now })).toBe(0);
    const before = await prisma.canvasVersion.count();
    await createAutoRetentionHandler(prisma)({} as never);
    expect(await prisma.canvasVersion.count()).toBeLessThanOrEqual(before);
    // The handler runs on the wall clock (these rows are long expired); the
    // manual versions must still all be there.
    expect(
      await prisma.canvasVersion.count({ where: { kind: "MANUAL" } }),
    ).toBe(manualIds.length);
  });

  it("converges to the same set when run as time passes", async () => {
    const owner = await makeUser("owner");
    const canvas = await makeCanvas(owner.id);
    // A version created at :05 of each hour for two days, three per hour.
    for (let hour = 0; hour < 48; hour += 1) {
      for (const minute of [5, 25, 45]) {
        const at = new Date(
          Date.UTC(2026, 5, 14, 12, 0) - hour * 3_600_000 + minute * MINUTE,
        );
        await seed(canvas.id, "AUTO", at.toISOString());
      }
    }
    const day = 86_400_000;
    await deleteExpiredAutoVersions(prisma, { now });
    const afterFirst = (await versionsOf(canvas.id)).map((v) => v.id);
    await deleteExpiredAutoVersions(prisma, {
      now: new Date(now.getTime() + 3_600_000),
    });
    const afterLater = (await versionsOf(canvas.id)).map((v) => v.id);
    // Moving the clock forward only ever removes rows; it never resurrects or
    // swaps the survivor of a bucket.
    expect(afterLater.every((id) => afterFirst.includes(id))).toBe(true);
    const eightDaysOn = new Date(now.getTime() + 8 * day);
    await deleteExpiredAutoVersions(prisma, { now: eightDaysOn });
    const afterDays = (await versionsOf(canvas.id)).map((v) => v.id);
    expect(afterDays.every((id) => afterLater.includes(id))).toBe(true);
    expect(afterDays.length).toBeLessThan(afterLater.length);
  });

  it("leaves the manual version cap to the manual-only retention job", async () => {
    const owner = await makeUser("owner");
    const canvas = await makeCanvas(owner.id);
    await prisma.canvasVersion.createMany({
      data: [
        ...Array.from(
          { length: LAUNCH_LIMITS.versionsPerCanvas + 2 },
          (_, i) => ({
            canvasId: canvas.id,
            kind: "MANUAL" as const,
            name: `Manual ${i}`,
            snapshot: {},
            createdAt: new Date(now.getTime() - i * 1000),
          }),
        ),
        ...Array.from({ length: 80 }, (_, i) => ({
          canvasId: canvas.id,
          kind: "AUTO" as const,
          name: `Auto ${i}`,
          snapshot: {},
          createdAt: new Date(now.getTime() - 5_000 - i * 1000),
        })),
      ],
    });
    await createVersionRetentionHandler(prisma)({} as never);
    expect(
      await prisma.canvasVersion.count({
        where: { canvasId: canvas.id, kind: "MANUAL" },
      }),
    ).toBe(LAUNCH_LIMITS.versionsPerCanvas);
    expect(
      await prisma.canvasVersion.count({
        where: { canvasId: canvas.id, kind: "AUTO" },
      }),
    ).toBe(80);
  });

  it("prunes finished sweep jobs once their dedupe window has passed", async () => {
    const old = new Date(Date.now() - 3 * 86_400_000);
    await prisma.outboxJob.createMany({
      data: [
        {
          type: AUTO_SNAPSHOT_JOB,
          payload: {},
          dedupeKey: "old-done",
          status: "COMPLETED",
          completedAt: old,
        },
        {
          type: AUTO_SNAPSHOT_JOB,
          payload: {},
          dedupeKey: "recent-done",
          status: "COMPLETED",
          completedAt: new Date(),
        },
        {
          type: AUTO_SNAPSHOT_JOB,
          payload: {},
          dedupeKey: "old-pending",
          status: "PENDING",
        },
        {
          type: "email.verification",
          payload: {},
          dedupeKey: "other-old-done",
          status: "COMPLETED",
          completedAt: old,
        },
      ],
    });
    await createAutoRetentionHandler(prisma)({} as never);
    const keys = (await prisma.outboxJob.findMany()).map((j) => j.dedupeKey);
    expect(keys.sort()).toEqual([
      "old-pending",
      "other-old-done",
      "recent-done",
    ]);
  });
});

describe("version history routes", () => {
  async function setup() {
    const owner = await makeUser("owner");
    const editor = await makeUser("editor");
    const viewer = await makeUser("viewer");
    const outsider = await makeUser("outsider");
    const canvas = await makeCanvas(owner.id);
    await prisma.canvasShare.createMany({
      data: [
        {
          canvasId: canvas.id,
          email: editor.email,
          recipientId: editor.id,
          role: "EDIT",
        },
        {
          canvasId: canvas.id,
          email: viewer.email,
          recipientId: viewer.id,
          role: "VIEW",
        },
      ],
    });
    const version = await prisma.canvasVersion.create({
      data: {
        canvasId: canvas.id,
        kind: "MANUAL",
        createdById: owner.id,
        name: "Baseline",
        snapshot: {
          schemaVersion: 1,
          name: "From the past",
          items: [
            {
              id: "cjld2cjxh0000qzrmn831i7rn",
              type: "SHAPE",
              positionX: 5,
              positionY: 6,
              width: 40,
              height: 40,
              zIndex: 0,
              content: { shapeType: "star" },
              tags: [],
            },
          ],
        },
      },
    });
    const auto = await prisma.canvasVersion.create({
      data: {
        canvasId: canvas.id,
        kind: "AUTO",
        name: "Auto-save",
        snapshot: { schemaVersion: 1, items: [] },
      },
    });
    return { owner, editor, viewer, outsider, canvas, version, auto };
  }

  function as(user: { id: string; email: string }) {
    authState.userId = user.id;
    authState.email = user.email;
  }

  it("lets viewers list and preview versions but not outsiders", async () => {
    const { viewer, outsider, canvas, version } = await setup();
    const listUrl = `http://localhost/api/v1/canvases/${canvas.id}/versions`;
    const ctx = { params: Promise.resolve({ canvasId: canvas.id }) };
    const detailCtx = {
      params: Promise.resolve({ canvasId: canvas.id, versionId: version.id }),
    };

    as(viewer);
    const listed = await listVersions(request(listUrl), ctx);
    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(body.pagination.total).toBe(2);
    expect(body.versions.map((v: { kind: string }) => v.kind).sort()).toEqual([
      "AUTO",
      "MANUAL",
    ]);
    expect(body.versions[0]).not.toHaveProperty("snapshot");
    expect(
      (await (await listVersions(request(`${listUrl}?kind=AUTO`), ctx)).json())
        .versions,
    ).toHaveLength(1);
    expect(
      (await listVersions(request(`${listUrl}?kind=BOGUS`), ctx)).status,
    ).toBe(400);
    const detail = await readVersion(
      request(`${listUrl}/${version.id}`),
      detailCtx,
    );
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      name: "Baseline",
      kind: "MANUAL",
      snapshot: { items: [{ positionX: 5 }] },
    });

    as(outsider);
    expect((await listVersions(request(listUrl), ctx)).status).toBe(403);
    expect(
      (await readVersion(request(`${listUrl}/${version.id}`), detailCtx))
        .status,
    ).toBe(403);
  });

  it("restricts restore and manual saves to editors and owners", async () => {
    const { owner, editor, viewer, outsider, canvas, version } = await setup();
    const restoreUrl = `http://localhost/api/v1/canvases/${canvas.id}/versions/${version.id}/restore`;
    const restoreCtx = {
      params: Promise.resolve({ canvasId: canvas.id, versionId: version.id }),
    };
    const saveUrl = `http://localhost/api/v1/canvases/${canvas.id}/versions`;
    const saveCtx = { params: Promise.resolve({ canvasId: canvas.id }) };

    for (const denied of [viewer, outsider]) {
      as(denied);
      expect(
        (await restoreVersion(request(restoreUrl, "POST"), restoreCtx)).status,
      ).toBe(403);
      expect(
        (await createVersion(request(saveUrl, "POST", {}), saveCtx)).status,
      ).toBe(403);
    }
    expect(
      (await prisma.canvas.findUniqueOrThrow({ where: { id: canvas.id } }))
        .name,
    ).toBe("History");
    expect(
      await prisma.canvasVersion.count({ where: { canvasId: canvas.id } }),
    ).toBe(2);

    as(editor);
    const restored = await restoreVersion(
      request(restoreUrl, "POST"),
      restoreCtx,
    );
    expect(restored.status).toBe(200);
    expect(
      (await prisma.canvas.findUniqueOrThrow({ where: { id: canvas.id } }))
        .name,
    ).toBe("From the past");
    const copy = await prisma.canvasVersion.findFirstOrThrow({
      where: { canvasId: canvas.id, name: "Restored Baseline" },
    });
    expect(copy).toMatchObject({ kind: "MANUAL", createdById: editor.id });

    as(owner);
    expect(
      (await restoreVersion(request(restoreUrl, "POST"), restoreCtx)).status,
    ).toBe(200);
    expect(
      (
        await restoreVersion(request(restoreUrl, "POST"), {
          params: Promise.resolve({ canvasId: canvas.id, versionId: "nope" }),
        })
      ).status,
    ).toBe(404);
  });

  it("does not count automatic snapshots against the manual version cap", async () => {
    const { owner, canvas } = await setup();
    await prisma.canvasVersion.createMany({
      data: Array.from(
        { length: LAUNCH_LIMITS.versionsPerCanvas + 5 },
        (_, i) => ({
          canvasId: canvas.id,
          kind: "AUTO" as const,
          name: `Auto ${i}`,
          snapshot: {},
        }),
      ),
    });
    as(owner);
    const saved = await createVersion(
      request(
        `http://localhost/api/v1/canvases/${canvas.id}/versions`,
        "POST",
        {
          name: "Still allowed",
        },
      ),
      { params: Promise.resolve({ canvasId: canvas.id }) },
    );
    expect(saved.status).toBe(201);
  });
});
