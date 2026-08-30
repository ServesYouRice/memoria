import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountExportStatus } from "@/generated/prisma/client";
import { RESOURCE_BUDGETS } from "@/lib/policy/resource-budgets";

const auth = vi.hoisted(() => ({ requireAuth: vi.fn() }));
const db = vi.hoisted(() => ({
  transaction: vi.fn(),
  executeRaw: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));
const outbox = vi.hoisted(() => ({ enqueue: vi.fn() }));
const storage = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock("@/lib/api/auth", () => ({ requireAuth: auth.requireAuth }));
vi.mock("@/lib/outbox/enqueue", () => ({
  enqueueOutboxJob: outbox.enqueue,
}));
vi.mock("@/lib/uploads/private-storage", () => ({
  readPrivateUploadObject: storage.read,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: db.transaction,
    accountExport: {
      findFirst: db.findFirst,
      findMany: db.findMany,
    },
  },
}));

import { POST } from "@/app/api/v1/users/account/exports/route";
import {
  GET as statusGet,
  DELETE as cancelDelete,
} from "@/app/api/v1/users/account/exports/[exportId]/route";
import { GET as downloadGet } from "@/app/api/v1/users/account/exports/[exportId]/download/route";

const userId = "cluserxxxxxxxxxxxxxxxxxxx";
const exportId = "clexportxxxxxxxxxxxxxxxxx";
const now = new Date("2026-08-29T12:00:00.000Z");
const expiresAt = new Date(
  now.getTime() + RESOURCE_BUDGETS.accountExport.retentionMs,
);

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: exportId,
    userId,
    status: AccountExportStatus.QUEUED,
    formatVersion: 2,
    storageMode: "local",
    storageKey: null,
    byteSize: null,
    sha256: null,
    manifest: null,
    lastError: null,
    cancelRequestedAt: null,
    startedAt: null,
    completedAt: null,
    expiresAt,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function request(url: string, method = "GET") {
  const value = new Request(url, { method });
  Object.assign(value, { nextUrl: new URL(url) });
  return value as never;
}

const context = { params: Promise.resolve({ exportId }) };

describe("background account export routes", () => {
  beforeEach(() => {
    // The download route compares `expiresAt` against `new Date()`. Without a
    // frozen clock the fixture stops being "not yet expired" once wall-clock
    // time passes it, so the suite would begin failing on a date rather than
    // on a code change. Only Date is faked; timers stay real so the route's
    // promises still settle.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    vi.clearAllMocks();
    auth.requireAuth.mockResolvedValue({ userId, email: "owner@example.com" });
    db.transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) =>
        callback({
          $executeRaw: db.executeRaw,
          accountExport: {
            findFirst: db.findFirst,
            create: db.create,
            update: db.update,
          },
        }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates one durable queued job under a per-user transaction lock", async () => {
    db.findFirst.mockResolvedValue(null);
    db.create.mockResolvedValue(record());

    const response = await POST(
      request("http://localhost/api/v1/users/account/exports", "POST"),
    );

    expect(response.status).toBe(202);
    expect(db.executeRaw).toHaveBeenCalledTimes(1);
    expect(db.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId,
        status: AccountExportStatus.QUEUED,
        formatVersion: 2,
      }),
    });
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "account-export.build",
        dedupeKey: `account-export.build:${exportId}`,
        payload: { exportId },
      }),
    );
  });

  it("reuses an active export instead of creating concurrent work", async () => {
    db.findFirst.mockResolvedValue(record());

    const response = await POST(
      request("http://localhost/api/v1/users/account/exports", "POST"),
    );

    expect(response.status).toBe(202);
    expect(db.create).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it("does not expose storage routing fields in status responses", async () => {
    db.findFirst.mockResolvedValue(
      record({
        storageKey: `account-exports/${userId}/${exportId}.jsonl.gz`,
      }),
    );
    const response = await statusGet(
      request(`http://localhost/api/v1/users/account/exports/${exportId}`),
      context,
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).not.toHaveProperty("userId");
    expect(payload).not.toHaveProperty("storageMode");
    expect(payload).not.toHaveProperty("storageKey");
    expect(payload).toMatchObject({ id: exportId, status: "QUEUED" });
  });

  it("returns only an export owned by the authenticated account", async () => {
    db.findFirst.mockResolvedValue(null);
    const response = await statusGet(
      request(`http://localhost/api/v1/users/account/exports/${exportId}`),
      context,
    );
    expect(response.status).toBe(404);
    expect(db.findFirst).toHaveBeenCalledWith({
      where: { id: exportId, userId },
    });
  });

  it("streams a completed archive with immutable checksum evidence", async () => {
    const sha256 = "ab".repeat(32);
    db.findFirst.mockResolvedValue(
      record({
        status: AccountExportStatus.COMPLETED,
        storageKey: `account-exports/${userId}/${exportId}.jsonl.gz`,
        byteSize: 7n,
        sha256,
      }),
    );
    storage.read.mockResolvedValue({
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("archive"));
          controller.close();
        },
      }),
      contentLength: 7,
      etag: 'W/"test"',
    });

    const response = await downloadGet(
      request(
        `http://localhost/api/v1/users/account/exports/${exportId}/download`,
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/gzip");
    expect(response.headers.get("X-Content-SHA256")).toBe(sha256);
    expect(response.headers.get("Content-Disposition")).toContain(".jsonl.gz");
    expect(await response.text()).toBe("archive");
  });

  it("marks active work cancelled and records a deletion intent for stored output", async () => {
    db.findFirst.mockResolvedValue(
      record({
        status: AccountExportStatus.COMPLETED,
        storageKey: `account-exports/${userId}/${exportId}.jsonl.gz`,
      }),
    );
    db.update.mockResolvedValue(
      record({ status: AccountExportStatus.CANCELLED }),
    );

    const response = await cancelDelete(
      request(
        `http://localhost/api/v1/users/account/exports/${exportId}`,
        "DELETE",
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(db.update).toHaveBeenCalledWith({
      where: { id: exportId },
      data: expect.objectContaining({ status: AccountExportStatus.CANCELLED }),
    });
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "account-export.delete" }),
    );
  });
});
