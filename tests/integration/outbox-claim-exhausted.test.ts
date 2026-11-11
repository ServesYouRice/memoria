import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { claimOutboxJobs } from "@/lib/outbox/repository";

const TYPE = "test.exhausted-lease";

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.outboxJob.deleteMany({ where: { type: TYPE } });
});

async function expiredRunningJob(attempts: number, maxAttempts = 3) {
  return prisma.outboxJob.create({
    data: {
      type: TYPE,
      payload: {},
      status: "RUNNING",
      attempts,
      maxAttempts,
      leaseOwner: "crashed-worker",
      leaseExpiresAt: new Date(Date.now() - 60_000),
    },
  });
}

describe("claimOutboxJobs and exhausted leases", () => {
  it("marks an expired job on its final attempt DEAD instead of reclaiming it", async () => {
    const exhausted = await expiredRunningJob(3);
    const retryable = await expiredRunningJob(1);

    const claimed = await claimOutboxJobs(prisma, {
      owner: "worker-a",
      limit: 10,
      leaseMs: 30_000,
      types: [TYPE],
    });

    expect(claimed.map((job) => job.id)).toEqual([retryable.id]);
    expect(claimed[0]!.attempts).toBe(2);
    const dead = await prisma.outboxJob.findUniqueOrThrow({
      where: { id: exhausted.id },
    });
    expect(dead).toMatchObject({
      status: "DEAD",
      attempts: 3,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    expect(dead.lastError).toMatch(/lease expired/i);
  });

  it("leaves a live final-attempt lease alone", async () => {
    const live = await prisma.outboxJob.create({
      data: {
        type: TYPE,
        payload: {},
        status: "RUNNING",
        attempts: 3,
        maxAttempts: 3,
        leaseOwner: "worker-b",
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    await claimOutboxJobs(prisma, {
      owner: "worker-a",
      limit: 10,
      leaseMs: 30_000,
      types: [TYPE],
    });
    expect(
      (await prisma.outboxJob.findUniqueOrThrow({ where: { id: live.id } }))
        .status,
    ).toBe("RUNNING");
  });
});
