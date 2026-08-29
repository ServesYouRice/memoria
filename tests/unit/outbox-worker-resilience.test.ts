import type { OutboxJob, PrismaClient } from "@/generated/prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  claimOutboxJobs: vi.fn(),
  completeOutboxJob: vi.fn(),
  failOutboxJob: vi.fn(),
  renewOutboxLease: vi.fn(),
}));
const incrementOperationalCounter = vi.hoisted(() => vi.fn());

vi.mock("@/lib/outbox/repository", () => repository);
vi.mock("@/lib/operations/runtime-metrics", () => ({
  incrementOperationalCounter,
}));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

import {
  OutboxHandlerTimeoutError,
  runOutboxWorker,
} from "@/lib/outbox/worker";

function job(id = "job-1"): OutboxJob {
  const now = new Date();
  return {
    id,
    type: "test.job",
    payload: {},
    dedupeKey: null,
    status: "RUNNING",
    attempts: 1,
    maxAttempts: 8,
    nextRunAt: now,
    leaseOwner: "worker-test",
    leaseExpiresAt: new Date(now.getTime() + 1_000),
    lastError: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

const prisma = {} as PrismaClient;

beforeEach(() => {
  vi.clearAllMocks();
  repository.claimOutboxJobs.mockReset();
  repository.completeOutboxJob.mockReset();
  repository.failOutboxJob.mockReset();
  repository.renewOutboxLease.mockReset();
  repository.completeOutboxJob.mockResolvedValue(true);
  repository.failOutboxJob.mockResolvedValue(true);
  repository.renewOutboxLease.mockResolvedValue(true);
});

describe("outbox worker resilience", () => {
  it("aborts a hung handler at its deadline and safely fails the owned job", async () => {
    const controller = new AbortController();
    repository.claimOutboxJobs.mockResolvedValueOnce([job()]);
    repository.failOutboxJob.mockImplementation(async () => {
      controller.abort();
      return true;
    });
    let handlerSignal: AbortSignal | undefined;

    await runOutboxWorker({
      prisma,
      handlers: {
        "test.job": async (_job, context) => {
          handlerSignal = context?.signal;
          await new Promise<void>(() => undefined);
        },
      },
      signal: controller.signal,
      owner: "worker-test",
      handlerTimeoutMs: 10,
      leaseMs: 1_000,
      pollMs: 1,
    });

    expect(handlerSignal?.aborted).toBe(true);
    expect(repository.failOutboxJob).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ id: "job-1" }),
      "worker-test",
      expect.any(OutboxHandlerTimeoutError),
    );
    expect(incrementOperationalCounter).toHaveBeenCalledWith(
      "outbox_handler_timeouts_total",
    );
  });

  it("renews ownership while a bounded handler is still running", async () => {
    const controller = new AbortController();
    repository.claimOutboxJobs.mockResolvedValueOnce([job()]);
    repository.claimOutboxJobs.mockImplementationOnce(async () => {
      controller.abort();
      return [];
    });

    await runOutboxWorker({
      prisma,
      handlers: {
        "test.job": async () => {
          await new Promise((resolve) => setTimeout(resolve, 325));
        },
      },
      signal: controller.signal,
      owner: "worker-test",
      handlerTimeoutMs: 600,
      leaseMs: 900,
      pollMs: 1,
    });

    expect(repository.renewOutboxLease).toHaveBeenCalledWith(
      prisma,
      "job-1",
      "worker-test",
      900,
    );
    expect(repository.completeOutboxJob).toHaveBeenCalledTimes(1);
  });

  it("does not complete or fail a job after lease ownership is lost", async () => {
    const controller = new AbortController();
    repository.claimOutboxJobs.mockResolvedValueOnce([job()]);
    repository.claimOutboxJobs.mockImplementationOnce(async () => {
      controller.abort();
      return [];
    });
    repository.renewOutboxLease.mockResolvedValue(false);

    await runOutboxWorker({
      prisma,
      handlers: {
        "test.job": async () => {
          await new Promise<void>(() => undefined);
        },
      },
      signal: controller.signal,
      owner: "worker-test",
      handlerTimeoutMs: 600,
      leaseMs: 900,
      pollMs: 1,
    });

    expect(repository.completeOutboxJob).not.toHaveBeenCalled();
    expect(repository.failOutboxJob).not.toHaveBeenCalled();
    expect(incrementOperationalCounter).toHaveBeenCalledWith(
      "outbox_lease_lost_total",
    );
  });

  it("bounds each claim to concurrency and drains claimed work on shutdown", async () => {
    const controller = new AbortController();
    const claimed = [job("job-1"), job("job-2"), job("job-3")];
    repository.claimOutboxJobs.mockImplementationOnce(
      async (_prisma: PrismaClient, options: { limit: number }) =>
        claimed.slice(0, options.limit),
    );
    repository.claimOutboxJobs.mockImplementationOnce(async () => {
      controller.abort();
      return [];
    });
    let active = 0;
    let maxActive = 0;

    await runOutboxWorker({
      prisma,
      handlers: {
        "test.job": async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          controller.abort();
          await new Promise((resolve) => setTimeout(resolve, 15));
          active -= 1;
        },
      },
      signal: controller.signal,
      owner: "worker-test",
      handlerTimeoutMs: 100,
      leaseMs: 1_000,
      concurrency: 2,
      batchSize: 20,
      pollMs: 1,
    });

    expect(repository.claimOutboxJobs).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ limit: 2 }),
    );
    expect(maxActive).toBe(2);
    expect(repository.completeOutboxJob).toHaveBeenCalledTimes(2);
  });

  it("survives a claim failure and records it before retrying", async () => {
    const controller = new AbortController();
    repository.claimOutboxJobs.mockRejectedValueOnce(new Error("db down"));
    repository.claimOutboxJobs.mockImplementationOnce(async () => {
      controller.abort();
      return [];
    });

    await runOutboxWorker({
      prisma,
      handlers: { "test.job": vi.fn() },
      signal: controller.signal,
      owner: "worker-test",
      handlerTimeoutMs: 100,
      leaseMs: 1_000,
      pollMs: 1,
    });

    expect(repository.claimOutboxJobs).toHaveBeenCalledTimes(2);
    expect(incrementOperationalCounter).toHaveBeenCalledWith(
      "outbox_poll_failures_total",
    );
  });
});
