import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";
import { OutboxJobStatus, ItemType } from "@/generated/prisma/client";

const prismaMocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
  outboxJobFindMany: vi.fn(),
  outboxJobUpdateMany: vi.fn(),
  userCount: vi.fn(),
  userCreate: vi.fn(),
  workspaceCreate: vi.fn(),
  canvasCreate: vi.fn(),
}));

const outboxMocks = vi.hoisted(() => ({
  enqueueOutboxJob: vi.fn(),
  replayDeadOutboxJob: vi.fn(),
}));

const operationsAuthMock = vi.hoisted(() => ({
  hasInternalOperationsAccess: vi.fn(),
}));

const bootstrapMocks = vi.hoisted(() => ({
  isBootstrapAvailable: vi.fn(),
}));

const passwordMocks = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  validatePasswordStrength: vi.fn(),
}));

const loggerMock = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: prismaMocks.$transaction,
    outboxJob: {
      findMany: prismaMocks.outboxJobFindMany,
      updateMany: prismaMocks.outboxJobUpdateMany,
    },
  },
}));

vi.mock("@/lib/outbox/enqueue", () => ({
  enqueueOutboxJob: outboxMocks.enqueueOutboxJob,
}));

vi.mock("@/lib/outbox/repository", () => ({
  replayDeadOutboxJob: outboxMocks.replayDeadOutboxJob,
}));

vi.mock("@/lib/operations/internal-auth", () => ({
  hasInternalOperationsAccess: operationsAuthMock.hasInternalOperationsAccess,
}));

vi.mock("@/lib/bootstrap", () => ({
  isBootstrapAvailable: bootstrapMocks.isBootstrapAvailable,
}));

vi.mock("@/lib/auth/password", () => ({
  hashPassword: passwordMocks.hashPassword,
}));

vi.mock("@/lib/validation/password", () => ({
  validatePasswordStrength: passwordMocks.validatePasswordStrength,
}));

vi.mock("@/lib/logger", () => ({
  logger: loggerMock,
  createLogger: () => loggerMock,
}));

vi.mock("@/lib/api/route-handler", () => ({
  withApiHandler: (handler: unknown) => handler,
}));

import { GET as maintenanceGet } from "@/app/api/cron/maintenance/route";
import { GET as refreshBookmarksGet } from "@/app/api/cron/refresh-bookmarks/route";
import {
  GET as outboxGet,
  POST as outboxPost,
} from "@/app/api/operations/outbox/route";
import { POST as setupInitializePost } from "@/app/api/setup/initialize/route";
import { POST as cspReportPost } from "@/app/api/csp-report/route";

function createNextRequest(
  url: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  },
): NextRequest {
  const init: RequestInit = {
    method: options?.method || "GET",
    headers: options?.headers || {},
  };
  if (options?.body !== undefined) {
    init.body =
      typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body);
  }
  const req = new Request(url, init);
  // Attach nextUrl for NextRequest compatibility
  (req as any).nextUrl = new URL(url);
  return req as unknown as NextRequest;
}

describe("Operator, Cron, Bootstrap, and CSP boundaries (IMP-058)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.useRealTimers();
  });

  describe("Cron GET handlers", () => {
    describe("maintenance cron route", () => {
      it("returns 500 when CRON_SECRET is unset or blank without running transaction", async () => {
        delete process.env.CRON_SECRET;
        const req = createNextRequest("http://localhost/api/cron/maintenance", {
          headers: { authorization: "Bearer some-token" },
        });

        await expect(maintenanceGet(req)).rejects.toMatchObject({
          status: 500,
          detail: "Cron secret not configured",
        });
        expect(prismaMocks.$transaction).not.toHaveBeenCalled();
      });

      it("returns 401 when authorization header is missing or wrong", async () => {
        process.env.CRON_SECRET = "valid-cron-secret-12345";

        const reqMissing = createNextRequest(
          "http://localhost/api/cron/maintenance",
        );
        await expect(maintenanceGet(reqMissing)).rejects.toMatchObject({
          status: 401,
          detail: "Invalid cron secret",
        });

        const reqWrong = createNextRequest(
          "http://localhost/api/cron/maintenance",
          {
            headers: { authorization: "Bearer wrong-secret" },
          },
        );
        await expect(maintenanceGet(reqWrong)).rejects.toMatchObject({
          status: 401,
          detail: "Invalid cron secret",
        });

        expect(prismaMocks.$transaction).not.toHaveBeenCalled();
      });

      it("queues the three daily retention jobs with stable dedupe keys", async () => {
        process.env.CRON_SECRET = "valid-cron-secret-12345";
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-08-25T14:30:00.000Z"));

        prismaMocks.$transaction.mockImplementation(async (callback: any) =>
          callback({}),
        );

        const req = createNextRequest("http://localhost/api/cron/maintenance", {
          headers: { authorization: "Bearer valid-cron-secret-12345" },
        });

        const res = await maintenanceGet(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toEqual({ queued: true, day: "2026-08-25" });

        expect(outboxMocks.enqueueOutboxJob).toHaveBeenCalledTimes(3);
        expect(outboxMocks.enqueueOutboxJob).toHaveBeenCalledWith(
          expect.anything(),
          {
            type: "retention.trash",
            payload: {},
            dedupeKey: "retention.trash:2026-08-25",
          },
        );
        expect(outboxMocks.enqueueOutboxJob).toHaveBeenCalledWith(
          expect.anything(),
          {
            type: "retention.versions",
            payload: {},
            dedupeKey: "retention.versions:2026-08-25",
          },
        );
        expect(outboxMocks.enqueueOutboxJob).toHaveBeenCalledWith(
          expect.anything(),
          {
            type: "retention.maintenance",
            payload: {},
            dedupeKey: "retention.maintenance:2026-08-25",
          },
        );
      });
    });

    describe("refresh-bookmarks cron route", () => {
      it("returns 500 when CRON_SECRET is unset", async () => {
        delete process.env.CRON_SECRET;
        const req = createNextRequest(
          "http://localhost/api/cron/refresh-bookmarks",
        );
        await expect(refreshBookmarksGet(req)).rejects.toMatchObject({
          status: 500,
          detail: "Cron secret not configured",
        });
        expect(prismaMocks.$transaction).not.toHaveBeenCalled();
      });

      it("enqueues jobs with 15-minute bucketed dedupe keys for selected bookmarks", async () => {
        process.env.CRON_SECRET = "valid-cron-secret-12345";
        vi.useFakeTimers();
        const fakeTimestamp = 1700000000000;
        vi.setSystemTime(new Date(fakeTimestamp));
        const expectedBucket = Math.floor(fakeTimestamp / (15 * 60 * 1000));

        const mockFindMany = vi
          .fn()
          .mockResolvedValue([{ id: "bm-1" }, { id: "bm-2" }]);
        prismaMocks.$transaction.mockImplementation(async (callback: any) =>
          callback({ canvasItem: { findMany: mockFindMany } }),
        );

        const req = createNextRequest(
          "http://localhost/api/cron/refresh-bookmarks",
          {
            headers: { authorization: "Bearer valid-cron-secret-12345" },
          },
        );

        const res = await refreshBookmarksGet(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toEqual({ queued: 2 });

        expect(mockFindMany).toHaveBeenCalledWith({
          where: {
            type: ItemType.BOOKMARK,
            deletedAt: null,
            OR: [
              { bookmarkRefreshedAt: null },
              {
                bookmarkRefreshedAt: {
                  lt: new Date(fakeTimestamp - 15 * 60 * 1000),
                },
              },
            ],
          },
          select: { id: true },
          orderBy: { bookmarkRefreshedAt: { sort: "asc", nulls: "first" } },
          take: 100,
        });

        expect(outboxMocks.enqueueOutboxJob).toHaveBeenCalledTimes(2);
        expect(outboxMocks.enqueueOutboxJob).toHaveBeenCalledWith(
          expect.anything(),
          {
            type: "bookmark.refresh",
            payload: { itemId: "bm-1" },
            dedupeKey: `bookmark.refresh:bm-1:${expectedBucket}`,
            maxAttempts: 6,
          },
        );
        expect(outboxMocks.enqueueOutboxJob).toHaveBeenCalledWith(
          expect.anything(),
          {
            type: "bookmark.refresh",
            payload: { itemId: "bm-2" },
            dedupeKey: `bookmark.refresh:bm-2:${expectedBucket}`,
            maxAttempts: 6,
          },
        );
      });
    });
  });

  describe("Operations outbox routes", () => {
    it("returns generic JSON 404 when hasInternalOperationsAccess is false", async () => {
      operationsAuthMock.hasInternalOperationsAccess.mockReturnValue(false);

      const getRes = await outboxGet(
        createNextRequest("http://localhost/api/operations/outbox"),
      );
      expect(getRes.status).toBe(404);
      expect(await getRes.json()).toEqual({ status: "not_found" });
      expect(prismaMocks.outboxJobFindMany).not.toHaveBeenCalled();

      const postRes = await outboxPost(
        createNextRequest("http://localhost/api/operations/outbox", {
          method: "POST",
          body: { action: "replay", jobId: "cjld2cjxh0000qzrmn831i7rn" },
        }),
      );
      expect(postRes.status).toBe(404);
      expect(await postRes.json()).toEqual({ status: "not_found" });
      expect(outboxMocks.replayDeadOutboxJob).not.toHaveBeenCalled();
      expect(prismaMocks.outboxJobUpdateMany).not.toHaveBeenCalled();
    });

    it("handles GET query limits with defaults, bounds, and rejection of invalid values", async () => {
      operationsAuthMock.hasInternalOperationsAccess.mockReturnValue(true);
      prismaMocks.outboxJobFindMany.mockResolvedValue([]);

      // Default limit 50
      await outboxGet(
        createNextRequest("http://localhost/api/operations/outbox"),
      );
      expect(prismaMocks.outboxJobFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );

      // Explicit limit 100
      await outboxGet(
        createNextRequest("http://localhost/api/operations/outbox?limit=100"),
      );
      expect(prismaMocks.outboxJobFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );

      // Limit 0 rejects before findMany
      await expect(
        outboxGet(
          createNextRequest("http://localhost/api/operations/outbox?limit=0"),
        ),
      ).rejects.toThrow();

      // Limit 101 rejects before findMany
      await expect(
        outboxGet(
          createNextRequest("http://localhost/api/operations/outbox?limit=101"),
        ),
      ).rejects.toThrow();

      // Malformed limit rejects before findMany
      await expect(
        outboxGet(
          createNextRequest(
            "http://localhost/api/operations/outbox?limit=invalid",
          ),
        ),
      ).rejects.toThrow();
    });

    it("rejects unknown keys in POST action schema and processes replay / cancel for valid CUIDs", async () => {
      operationsAuthMock.hasInternalOperationsAccess.mockReturnValue(true);
      const validCuid = "cjld2cjxh0000qzrmn831i7rn";

      // Reject unknown keys in strict schema
      await expect(
        outboxPost(
          createNextRequest("http://localhost/api/operations/outbox", {
            method: "POST",
            body: { action: "replay", jobId: validCuid, unknownField: true },
          }),
        ),
      ).rejects.toThrow();

      // Reject invalid CUID
      await expect(
        outboxPost(
          createNextRequest("http://localhost/api/operations/outbox", {
            method: "POST",
            body: { action: "replay", jobId: "not-a-cuid" },
          }),
        ),
      ).rejects.toThrow();

      // Valid replay action
      outboxMocks.replayDeadOutboxJob.mockResolvedValue({ count: 1 });
      const replayRes = await outboxPost(
        createNextRequest("http://localhost/api/operations/outbox", {
          method: "POST",
          body: { action: "replay", jobId: validCuid },
        }),
      );
      expect(replayRes.status).toBe(200);
      expect(await replayRes.json()).toEqual({ updated: true });
      expect(outboxMocks.replayDeadOutboxJob).toHaveBeenCalledWith(
        expect.anything(),
        validCuid,
      );

      // Valid cancel action
      prismaMocks.outboxJobUpdateMany.mockResolvedValue({ count: 1 });
      const cancelRes = await outboxPost(
        createNextRequest("http://localhost/api/operations/outbox", {
          method: "POST",
          body: { action: "cancel", jobId: validCuid },
        }),
      );
      expect(cancelRes.status).toBe(200);
      expect(await cancelRes.json()).toEqual({ updated: true });
      expect(prismaMocks.outboxJobUpdateMany).toHaveBeenCalledWith({
        where: {
          id: validCuid,
          status: { in: [OutboxJobStatus.PENDING, OutboxJobStatus.RUNNING] },
        },
        data: {
          status: OutboxJobStatus.DEAD,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: "Cancelled by operator.",
        },
      });
    });
  });

  describe("Setup initialize (Bootstrap)", () => {
    it("denies request early when bootstrap is unavailable or token is wrong without password hashing or transaction", async () => {
      // Case 1: isBootstrapAvailable is false
      bootstrapMocks.isBootstrapAvailable.mockResolvedValue(false);
      const resUnavailable = await setupInitializePost(
        createNextRequest("http://localhost/api/setup/initialize", {
          method: "POST",
          body: {
            name: "Admin",
            email: "admin@example.com",
            password: "SecurePassword123!",
          },
        }),
      );
      expect(resUnavailable.status).toBe(409);
      expect(passwordMocks.hashPassword).not.toHaveBeenCalled();
      expect(prismaMocks.$transaction).not.toHaveBeenCalled();

      // Case 2: In production with invalid token
      bootstrapMocks.isBootstrapAvailable.mockResolvedValue(true);
      process.env.NODE_ENV = "production";
      process.env.APP_BOOTSTRAP_TOKEN = "correct-length-bootstrap-token-12345";

      const resWrongToken = await setupInitializePost(
        createNextRequest("http://localhost/api/setup/initialize", {
          method: "POST",
          body: {
            token: "wrong-token-of-different-length",
            name: "Admin",
            email: "admin@example.com",
            password: "SecurePassword123!",
          },
        }),
      );
      expect(resWrongToken.status).toBe(401);
      expect(passwordMocks.hashPassword).not.toHaveBeenCalled();
      expect(prismaMocks.$transaction).not.toHaveBeenCalled();
    });

    it("allows localhost bypass only outside production", async () => {
      bootstrapMocks.isBootstrapAvailable.mockResolvedValue(true);
      passwordMocks.validatePasswordStrength.mockResolvedValue({
        isValid: true,
        feedback: { suggestions: [] },
      });
      passwordMocks.hashPassword.mockResolvedValue("$argon2id$hashedAdminPass");

      prismaMocks.$transaction.mockImplementation(
        async (callback: any, options: any) => {
          expect(options).toEqual({ isolationLevel: "Serializable" });
          const tx = {
            user: {
              count: vi.fn().mockResolvedValue(0),
              create: vi.fn().mockResolvedValue({
                id: "u-1",
                email: "admin@example.com",
                name: "Admin",
              }),
            },
            workspace: {
              create: vi
                .fn()
                .mockResolvedValue({ id: "ws-1", name: "Personal" }),
            },
            canvas: {
              create: vi.fn().mockResolvedValue({ id: "c-1", name: "Inbox" }),
            },
          };
          return callback(tx);
        },
      );

      // Under development, request to localhost succeeds without token
      process.env.NODE_ENV = "development";
      const resDev = await setupInitializePost(
        createNextRequest("http://localhost/api/setup/initialize", {
          method: "POST",
          body: {
            name: "Admin",
            email: "admin@example.com",
            password: "SecurePassword123!",
          },
        }),
      );
      expect(resDev.status).toBe(201);

      // Under production, localhost request without valid token is rejected with 401
      process.env.NODE_ENV = "production";
      process.env.APP_BOOTSTRAP_TOKEN = "production-secret-token-12345";
      const resProd = await setupInitializePost(
        createNextRequest("http://localhost/api/setup/initialize", {
          method: "POST",
          body: {
            name: "Admin",
            email: "admin@example.com",
            password: "SecurePassword123!",
          },
        }),
      );
      expect(resProd.status).toBe(401);
    });

    it("verifies user count is 0 inside Serializable transaction before creating user", async () => {
      process.env.NODE_ENV = "development";
      bootstrapMocks.isBootstrapAvailable.mockResolvedValue(true);
      passwordMocks.validatePasswordStrength.mockResolvedValue({
        isValid: true,
        feedback: { suggestions: [] },
      });
      passwordMocks.hashPassword.mockResolvedValue("$argon2id$hashedAdminPass");

      const mockUserCreate = vi.fn();
      prismaMocks.$transaction.mockImplementation(
        async (callback: any, options: any) => {
          expect(options).toEqual({ isolationLevel: "Serializable" });
          const tx = {
            user: {
              // Simulate race condition where user count became 1
              count: vi.fn().mockResolvedValue(1),
              create: mockUserCreate,
            },
          };
          return callback(tx);
        },
      );

      const res = await setupInitializePost(
        createNextRequest("http://localhost/api/setup/initialize", {
          method: "POST",
          body: {
            name: "Admin",
            email: "admin@example.com",
            password: "SecurePassword123!",
          },
        }),
      );

      expect(res.status).toBe(409);
      expect(mockUserCreate).not.toHaveBeenCalled();
    });
  });

  describe("CSP Report POST", () => {
    it("returns 413 when UTF-8 body exceeds 16 KiB without calling logger.warn", async () => {
      // 16 KiB is 16384 bytes. Create a payload that exceeds 16384 UTF-8 bytes
      const largePayload = "a".repeat(16385);
      const req = createNextRequest("http://localhost/api/csp-report", {
        method: "POST",
        body: largePayload,
      });

      const res = await cspReportPost(req);
      expect(res.status).toBe(413);
      expect(loggerMock.warn).not.toHaveBeenCalled();
    });

    it("contains malformed JSON and returns 204", async () => {
      const req = createNextRequest("http://localhost/api/csp-report", {
        method: "POST",
        body: "invalid-not-json-content{",
      });

      const res = await cspReportPost(req);
      expect(res.status).toBe(204);
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.anything(),
        "Failed to process CSP report",
      );
      expect(loggerMock.warn).not.toHaveBeenCalled();
    });

    it("logs only bounded schema fields to logger.warn and strips unknown fields", async () => {
      const payload = {
        "csp-report": {
          "document-uri": "https://example.com/canvas/123",
          "violated-directive": "script-src 'self'",
          "effective-directive": "script-src",
          "blocked-uri": "https://evil.com/xss.js",
          "source-file": "https://example.com/main.js",
          "line-number": 42,
          "column-number": 12,
          "unknown-leak-field": "sensitive_data_that_must_be_stripped",
        },
        "extra-root-field": "strip-me",
      };

      const req = createNextRequest("http://localhost/api/csp-report", {
        method: "POST",
        body: payload,
      });

      const res = await cspReportPost(req);
      expect(res.status).toBe(204);

      expect(loggerMock.warn).toHaveBeenCalledTimes(1);
      const logArgument = loggerMock.warn.mock.calls[0][0];

      expect(logArgument).toEqual({
        type: "csp-violation",
        documentUri: "https://example.com/canvas/123",
        violatedDirective: "script-src 'self'",
        effectiveDirective: "script-src",
        blockedUri: "https://evil.com/xss.js",
        sourceFile: "https://example.com/main.js",
        lineNumber: 42,
        columnNumber: 12,
      });
      // Unknown fields are not passed to logger
      expect((logArgument as any)["unknown-leak-field"]).toBeUndefined();
      expect((logArgument as any)["extra-root-field"]).toBeUndefined();
    });
  });
});
