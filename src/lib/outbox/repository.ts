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
  return prisma.$queryRaw<OutboxJob[]>`
    WITH candidates AS (
      SELECT "id"
      FROM "OutboxJob"
      WHERE "type" IN (${Prisma.join(options.types)})
        AND (
          ("status" = 'PENDING' AND "nextRunAt" <= NOW())
          OR ("status" = 'RUNNING' AND "leaseExpiresAt" < NOW())
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
  `;
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
