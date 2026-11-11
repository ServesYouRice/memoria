import type { OutboxJob, PrismaClient } from "@/generated/prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  claimOutboxJobs: vi.fn(),
  completeOutboxJob: vi.fn(),
  failOutboxJob: vi.fn(),
  renewOutboxLease: vi.fn(),
}));
const incrementOperationalCounter = vi.hoisted(() => vi.fn());
const log = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/outbox/repository", () => repository);
vi.mock("@/lib/operations/runtime-metrics", () => ({
  incrementOperationalCounter,
}));
vi.mock("@/lib/logger", () => ({ createLogger: () => log }));

import { runOutboxWorker } from "@/lib/outbox/worker";

function job(id: string): OutboxJob {
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
  repository.completeOutboxJob.mockReset().mockResolvedValue(true);
  repository.failOutboxJob.mockReset().mockResolvedValue(true);
  repository.renewOutboxLease.mockReset().mockResolvedValue(true);
});

const baseOptions = {
  prisma,
  owner: "worker-test",
  handlerTimeoutMs: 500,
  leaseMs: 2_000,
  pollMs: 1,
};

describe("outbox worker state-write failures", () => {
  it("keeps polling when recording a job outcome rejects", async () => {
    const controller = new AbortController();
    let claims = 0;
    repository.claimOutboxJobs.mockImplementation(async () => {
      claims += 1;
      if (claims === 1) return [job("ok"), job("bad")];
      // Both outcome writes have failed by now; abort only after polling on.
      if (log.error.mock.calls.length === 2 && claims >= 3) controller.abort();
      return [];
    });
    // processJob records a failed completion as a failure, so the database
    // stays down for failOutboxJob: both jobs end with a rejected write.
    repository.completeOutboxJob.mockRejectedValueOnce(new Error("db blip"));
    repository.failOutboxJob.mockRejectedValue(new Error("db blip"));

    await expect(
      runOutboxWorker({
        ...baseOptions,
        signal: controller.signal,
        concurrency: 2,
        handlers: {
          "test.job": async (claimed) => {
            if (claimed.id === "bad") throw new Error("handler failed");
          },
        },
      }),
    ).resolves.toBeUndefined();

    expect(claims).toBeGreaterThanOrEqual(3);
    expect(repository.completeOutboxJob).toHaveBeenCalledTimes(1);
    expect(repository.failOutboxJob).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenCalledTimes(2);
  });
});

describe("outbox worker slots", () => {
  it("fills a freed slot while a slow job is still running", async () => {
    const controller = new AbortController();
    let releaseSlow!: () => void;
    const slowDone = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const started: string[] = [];
    let active = 0;
    let maxActive = 0;
    let slowFinished = false;

    repository.claimOutboxJobs.mockImplementation(
      async (_prisma: PrismaClient, options: { limit: number }) => {
        const queue = [job("slow"), job("fast"), job("third")].filter(
          (candidate) => !started.includes(candidate.id),
        );
        return queue.slice(0, options.limit);
      },
    );

    const worker = runOutboxWorker({
      ...baseOptions,
      handlerTimeoutMs: 5_000,
      leaseMs: 10_000,
      signal: controller.signal,
      concurrency: 2,
      handlers: {
        "test.job": async (claimed) => {
          started.push(claimed.id);
          active += 1;
          maxActive = Math.max(maxActive, active);
          try {
            if (claimed.id === "slow") {
              await slowDone;
              slowFinished = true;
            }
          } finally {
            active -= 1;
          }
        },
      },
    });

    await vi.waitFor(() => expect(started).toContain("third"), {
      timeout: 1_000,
    });
    expect(slowFinished).toBe(false);
    expect(maxActive).toBeLessThanOrEqual(2);

    controller.abort();
    releaseSlow();
    await worker;
    expect(slowFinished).toBe(true);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(repository.completeOutboxJob).toHaveBeenCalledTimes(3);
  });

  it("waits for in-flight jobs before it resolves on abort", async () => {
    const controller = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    repository.claimOutboxJobs.mockResolvedValueOnce([job("one")]);
    repository.claimOutboxJobs.mockResolvedValue([]);
    let resolved = false;
    const worker = runOutboxWorker({
      ...baseOptions,
      signal: controller.signal,
      concurrency: 2,
      handlers: { "test.job": () => gate },
    }).then(() => {
      resolved = true;
    });

    await vi.waitFor(() =>
      expect(repository.claimOutboxJobs).toHaveBeenCalled(),
    );
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(resolved).toBe(false);
    release();
    await worker;
    expect(repository.completeOutboxJob).toHaveBeenCalledTimes(1);
  });
});
