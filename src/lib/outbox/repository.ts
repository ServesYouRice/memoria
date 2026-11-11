import {
  OutboxJobStatus,
  Prisma,
  type OutboxJob,
  type PrismaClient,
} from "@/generated/prisma/client";

export function retryDelayMs(attempts: number): number {
  return Math.min(60 * 60 * 1000, 1000 * 2 ** Math.max(0, attempts - 1));
}

export async function claimOutboxJobs(
  prisma: PrismaClient,
  options: { owner: string; limit: number; leaseMs: number; types: string[] },
): Promise<OutboxJob[]> {
  if (options.types.length === 0) return [];
  const leaseExpiresAt = new Date(Date.now() + options.leaseMs);
  const types = Prisma.join(options.types);
  // A job whose worker died (or lost its lease) on the final attempt never
  // reaches failOutboxJob, so it goes DEAD here instead of being reclaimed
  // forever. Both statements run in one transaction; each is also guarded on
  // its own (the claim never picks an exhausted job), so several workers at
  // once stay safe.
  const [, claimed] = await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE "OutboxJob"
      SET "status" = 'DEAD',
          "leaseOwner" = NULL,
          "leaseExpiresAt" = NULL,
          "lastError" = 'Lease expired after the final attempt',
          "updatedAt" = NOW()
      WHERE "type" IN (${types})
        AND "status" = 'RUNNING'
        AND "leaseExpiresAt" < NOW()
        AND "attempts" >= "maxAttempts"
    `,
    prisma.$queryRaw<OutboxJob[]>`
      WITH candidates AS (
        SELECT "id"
        FROM "OutboxJob"
        WHERE "type" IN (${types})
          AND (
            ("status" = 'PENDING' AND "nextRunAt" <= NOW())
            OR (
              "status" = 'RUNNING'
              AND "leaseExpiresAt" < NOW()
              AND "attempts" < "maxAttempts"
            )
          )
        ORDER BY "nextRunAt", "createdAt"
        FOR UPDATE SKIP LOCKED
        LIMIT ${options.limit}
      )
      UPDATE "OutboxJob" AS job
      SET "status" = 'RUNNING',
          "leaseOwner" = ${options.owner},
          "leaseExpiresAt" = ${leaseExpiresAt},
          "attempts" = job."attempts" + 1,
          "updatedAt" = NOW()
      FROM candidates
      WHERE job."id" = candidates."id"
      RETURNING job.*
    `,
  ]);
  return claimed;
}

export async function completeOutboxJob(
  prisma: PrismaClient,
  jobId: string,
  owner: string,
): Promise<boolean> {
  const result = await prisma.outboxJob.updateMany({
    where: { id: jobId, status: OutboxJobStatus.RUNNING, leaseOwner: owner },
    data: {
      status: OutboxJobStatus.COMPLETED,
      completedAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: null,
    },
  });
  return result.count === 1;
}

/**
 * Puts an owned job back to PENDING until `retryAt`. The claim counted an
 * attempt; a deferral is not a failure, so it gives that attempt back.
 */
export async function deferOutboxJob(
  prisma: PrismaClient,
  jobId: string,
  owner: string,
  retryAt: Date,
  reason: string,
): Promise<boolean> {
  const result = await prisma.outboxJob.updateMany({
    where: { id: jobId, status: OutboxJobStatus.RUNNING, leaseOwner: owner },
    data: {
      status: OutboxJobStatus.PENDING,
      nextRunAt: retryAt,
      attempts: { decrement: 1 },
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: reason.slice(0, 500),
    },
  });
  return result.count === 1;
}

export async function renewOutboxLease(
  prisma: PrismaClient,
  jobId: string,
  owner: string,
  leaseMs: number,
): Promise<boolean> {
  const result = await prisma.outboxJob.updateMany({
    where: { id: jobId, status: OutboxJobStatus.RUNNING, leaseOwner: owner },
    data: { leaseExpiresAt: new Date(Date.now() + leaseMs) },
  });
  return result.count === 1;
}

export async function failOutboxJob(
  prisma: PrismaClient,
  job: OutboxJob,
  owner: string,
  error: unknown,
): Promise<boolean> {
  const retryable = !(
    error &&
    typeof error === "object" &&
    "retryable" in error &&
    error.retryable === false
  );
  const dead = !retryable || job.attempts >= job.maxAttempts;
  const safeError =
    error instanceof Error
      ? error.message.slice(0, 500)
      : "Unknown handler failure";
  const result = await prisma.outboxJob.updateMany({
    where: { id: job.id, status: OutboxJobStatus.RUNNING, leaseOwner: owner },
    data: {
      status: dead ? OutboxJobStatus.DEAD : OutboxJobStatus.PENDING,
      nextRunAt: new Date(Date.now() + retryDelayMs(job.attempts)),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: safeError,
    },
  });
  return result.count === 1;
}

export async function replayDeadOutboxJob(prisma: PrismaClient, jobId: string) {
  return prisma.outboxJob.updateMany({
    where: { id: jobId, status: OutboxJobStatus.DEAD },
    data: {
      status: OutboxJobStatus.PENDING,
      attempts: 0,
      nextRunAt: new Date(),
      lastError: null,
    },
  });
}
