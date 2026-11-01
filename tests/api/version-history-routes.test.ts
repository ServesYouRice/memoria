import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";

const authMocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireCanvasAccess: vi.fn(),
}));
const db = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
  $transaction: vi.fn(),
}));
const outbox = vi.hoisted(() => ({ enqueueOutboxJob: vi.fn() }));

vi.mock("@/lib/api/auth", () => ({
  requireAuth: authMocks.requireAuth,
  requireCanvasAccess: authMocks.requireCanvasAccess,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    canvasVersion: {
      findMany: db.findMany,
      findFirst: db.findFirst,
      count: db.count,
    },
    $transaction: db.$transaction,
  },
}));
vi.mock("@/lib/outbox/enqueue", () => ({
  enqueueOutboxJob: outbox.enqueueOutboxJob,
}));

import {
  GET as listVersions,
  POST as createVersion,
} from "@/app/api/v1/canvases/[canvasId]/versions/route";
import { GET as readVersion } from "@/app/api/v1/canvases/[canvasId]/versions/[versionId]/route";
import { POST as restoreVersion } from "@/app/api/v1/canvases/[canvasId]/versions/[versionId]/restore/route";
import { GET as cronGet } from "@/app/api/cron/version-history/route";

function req(url: string, method = "GET", body?: unknown, headers = {}) {
  const request = new Request(url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  (request as any).nextUrl = new URL(url);
  return request as unknown as NextRequest;
}

const base = "http://localhost/api/v1/canvases/canvas-1/versions";
const ctx = { params: Promise.resolve({ canvasId: "canvas-1" }) };
const versionCtx = {
  params: Promise.resolve({ canvasId: "canvas-1", versionId: "version-1" }),
};
const user = { userId: "user-1", email: "user@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.requireAuth.mockResolvedValue(user);
  authMocks.requireCanvasAccess.mockResolvedValue("VIEW");
});

describe("version history routes: authentication and authorization", () => {
  it("rejects unauthenticated requests before touching the database", async () => {
    authMocks.requireAuth.mockRejectedValue(new UnauthorizedError());
    expect((await listVersions(req(base), ctx)).status).toBe(401);
    expect(
      (await readVersion(req(`${base}/version-1`), versionCtx)).status,
    ).toBe(401);
    expect(
      (
        await restoreVersion(
          req(`${base}/version-1/restore`, "POST"),
          versionCtx,
        )
      ).status,
    ).toBe(401);
    expect((await createVersion(req(base, "POST", {}), ctx)).status).toBe(401);
    expect(db.findMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("lets a viewer list and preview, asking only for VIEW access", async () => {
    db.findMany.mockResolvedValue([
      {
        id: "version-1",
        name: "Auto-save",
        kind: "AUTO",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        createdBy: null,
      },
    ]);
    db.count.mockResolvedValue(1);
    const listed = await listVersions(req(base), ctx);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      versions: [{ id: "version-1", kind: "AUTO" }],
      pagination: { total: 1, hasMore: false },
    });
    expect(authMocks.requireCanvasAccess).toHaveBeenLastCalledWith(
      "canvas-1",
      user.userId,
      user.email,
      "VIEW",
    );
    // The list never selects the (large) snapshot.
    expect(db.findMany.mock.calls[0][0].select).not.toHaveProperty("snapshot");

    db.findFirst.mockResolvedValue({
      id: "version-1",
      name: "Auto-save",
      kind: "AUTO",
      createdAt: new Date(),
      createdBy: null,
      snapshot: { items: [] },
    });
    const detail = await readVersion(req(`${base}/version-1`), versionCtx);
    expect(detail.status).toBe(200);
    expect(db.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "version-1", canvasId: "canvas-1" },
      }),
    );
    expect(authMocks.requireCanvasAccess).toHaveBeenLastCalledWith(
      "canvas-1",
      user.userId,
      user.email,
      "VIEW",
    );
  });

  it("returns 403 for a user without view access and 404 for an unknown version", async () => {
    authMocks.requireCanvasAccess.mockRejectedValueOnce(new ForbiddenError());
    expect((await listVersions(req(base), ctx)).status).toBe(403);
    authMocks.requireCanvasAccess.mockRejectedValueOnce(new ForbiddenError());
    expect(
      (await readVersion(req(`${base}/version-1`), versionCtx)).status,
    ).toBe(403);
    expect(db.findFirst).not.toHaveBeenCalled();

    db.findFirst.mockResolvedValue(null);
    expect(
      (await readVersion(req(`${base}/version-1`), versionCtx)).status,
    ).toBe(404);
  });

  it("requires EDIT access, inside the transaction, to restore or save", async () => {
    const tx = { $executeRawUnsafe: vi.fn(), $queryRaw: vi.fn() };
    db.$transaction.mockImplementation(async (callback: any) => callback(tx));
    authMocks.requireCanvasAccess.mockRejectedValue(new ForbiddenError());

    const restored = await restoreVersion(
      req(`${base}/version-1/restore`, "POST"),
      versionCtx,
    );
    expect(restored.status).toBe(403);
    expect(authMocks.requireCanvasAccess).toHaveBeenCalledWith(
      "canvas-1",
      user.userId,
      user.email,
      "EDIT",
      tx,
    );

    const saved = await createVersion(req(base, "POST", { name: "x" }), ctx);
    expect(saved.status).toBe(403);
    expect(authMocks.requireCanvasAccess).toHaveBeenLastCalledWith(
      "canvas-1",
      user.userId,
      user.email,
      "EDIT",
      tx,
    );
  });
});

describe("version history routes: validation", () => {
  it("rejects an unknown kind filter and malformed save bodies", async () => {
    expect(
      (await listVersions(req(`${base}?kind=SOMETHING`), ctx)).status,
    ).toBe(400);
    expect(
      (await createVersion(req(base, "POST", { name: "" }), ctx)).status,
    ).toBe(400);
    expect(
      (await createVersion(req(base, "POST", { name: "ok", extra: 1 }), ctx))
        .status,
    ).toBe(400);
    expect(
      (await createVersion(req(base, "POST", { name: "x".repeat(101) }), ctx))
        .status,
    ).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("filters the list by kind when asked", async () => {
    db.findMany.mockResolvedValue([]);
    db.count.mockResolvedValue(0);
    expect((await listVersions(req(`${base}?kind=MANUAL`), ctx)).status).toBe(
      200,
    );
    expect(db.findMany.mock.calls[0][0].where).toEqual({
      canvasId: "canvas-1",
      kind: "MANUAL",
    });
  });

  it("rejects malformed path parameters", async () => {
    const bad = {
      params: Promise.resolve({ canvasId: "canvas-1", versionId: "" }),
    };
    expect((await readVersion(req(`${base}/`), bad)).status).toBe(400);
    expect(
      (await restoreVersion(req(`${base}//restore`, "POST"), bad)).status,
    ).toBe(400);
  });
});

describe("version history cron route", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "version-cron-secret-0123456789";
  });

  it("requires the cron secret", async () => {
    const missing = await cronGet(
      req("http://localhost/api/cron/version-history"),
    );
    expect(missing.status).toBe(401);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("queues one snapshot sweep per five minutes and one thinning per hour", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T14:32:10.000Z"));
    db.$transaction.mockImplementation(async (callback: any) => callback({}));
    try {
      const response = await cronGet(
        req("http://localhost/api/cron/version-history", "GET", undefined, {
          authorization: `Bearer ${process.env.CRON_SECRET}`,
        }),
      );
      expect(response.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
    const fiveMinuteBucket = Math.floor(
      new Date("2026-08-25T14:32:10.000Z").getTime() / 300_000,
    );
    const hourBucket = Math.floor(
      new Date("2026-08-25T14:32:10.000Z").getTime() / 3_600_000,
    );
    expect(outbox.enqueueOutboxJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "versions.auto-snapshot",
        dedupeKey: `versions.auto-snapshot:${fiveMinuteBucket}`,
      }),
    );
    expect(outbox.enqueueOutboxJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "versions.auto-retention",
        dedupeKey: `versions.auto-retention:${hourBucket}`,
      }),
    );
  });
});
