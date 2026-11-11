import type { OutboxJob, PrismaClient } from "@/generated/prisma/client";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";
import type { OutboxHandler, OutboxHandlerContext } from "@/lib/outbox/types";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";

/** Rows one retention DELETE may remove; each runs as its own statement. */
export const RETENTION_BATCH_SIZE = 500;

/**
 * How long one retention run keeps deleting batches: a quarter of the
 * worker's default 30 s lease (half its default 15 s handler deadline), so a
 * run ends long before the lease could lapse. A run also stops a second
 * before the worker's own deadline when that is sooner.
 */
export const RETENTION_TIME_BUDGET_MS = 7_500;
const DEADLINE_MARGIN_MS = 1_000;

/**
 * Repeats one bounded delete step while it removes a full batch and the time
 * budget and abort signal allow; at least one batch runs unless the signal
 * has already aborted. Returns true when work may remain: the last batch was
 * full (or none ran) when the run stopped.
 */
export async function runBatchedRetention(
  step: () => Promise<number>,
  options: {
    batchSize?: number;
    deadlineAt: number;
    signal?: AbortSignal;
  },
) {
  const batchSize = options.batchSize ?? RETENTION_BATCH_SIZE;
  if (options.signal?.aborted) return true;
  for (;;) {
    const deleted = await step();
    if (deleted < batchSize) return false;
    if (options.signal?.aborted || Date.now() >= options.deadlineAt) {
      return true;
    }
  }
}

function retentionDeadline(context?: OutboxHandlerContext) {
  const budgetEnd = Date.now() + RETENTION_TIME_BUDGET_MS;
  if (!context) return budgetEnd;
  return Math.min(budgetEnd, context.deadlineAt.getTime() - DEADLINE_MARGIN_MS);
}

/**
 * The cron queues each retention type once per UTC day, so a run that stops
 * with work left queues one follow-up run of the same type (at most one per
 * run, keyed by this job's id).
 */
async function enqueueContinuation(prisma: PrismaClient, job: OutboxJob) {
  await enqueueOutboxJob(prisma, {
    type: job.type,
    payload: {},
    dedupeKey: `${job.type}:continuation:${job.id}`,
  });
}

export function createTrashRetentionHandler(
  prisma: PrismaClient,
): OutboxHandler {
  return async (job, context) => {
    const cutoff = new Date(
      Date.now() - LAUNCH_LIMITS.trashRetentionDays * 86_400_000,
    );
    const remains = await runBatchedRetention(
      () => prisma.$executeRaw`
        WITH doomed AS (
          SELECT "id" FROM "CanvasItem"
          WHERE "deletedAt" < ${cutoff}
            -- IMP-070: archived items wait in the trash until the user acts.
            AND "archivedAt" IS NULL
          ORDER BY "deletedAt" ASC
          LIMIT ${RETENTION_BATCH_SIZE}
        )
        DELETE FROM "CanvasItem" item USING doomed WHERE item."id" = doomed."id"
      `,
      { deadlineAt: retentionDeadline(context), signal: context?.signal },
    );
    if (remains) await enqueueContinuation(prisma, job);
  };
}

export function createVersionRetentionHandler(
  prisma: PrismaClient,
): OutboxHandler {
  return async (job, context) => {
    const remains = await runBatchedRetention(
      () => prisma.$executeRaw`
        WITH ranked AS (
          SELECT "id", ROW_NUMBER() OVER (PARTITION BY "canvasId" ORDER BY "createdAt" DESC, "id" DESC) AS rank
          FROM "CanvasVersion"
          WHERE "kind" = 'MANUAL'
        ), doomed AS (
          SELECT "id" FROM ranked WHERE rank > ${LAUNCH_LIMITS.versionsPerCanvas} LIMIT ${RETENTION_BATCH_SIZE}
        )
        DELETE FROM "CanvasVersion" version USING doomed WHERE version."id" = doomed."id"
      `,
      { deadlineAt: retentionDeadline(context), signal: context?.signal },
    );
    if (remains) await enqueueContinuation(prisma, job);
  };
}

export function createMaintenanceRetentionHandler(
  prisma: PrismaClient,
): OutboxHandler {
  return async (job, context) => {
    const idempotencyCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const candidateCutoff = new Date(Date.now() - 60 * 60 * 1000);
    const deadlineAt = retentionDeadline(context);
    const keysRemain = await runBatchedRetention(
      () => prisma.$executeRaw`
        DELETE FROM "IdempotencyKey" WHERE "id" IN (
          SELECT "id" FROM "IdempotencyKey" WHERE "createdAt" < ${idempotencyCutoff}
          ORDER BY "createdAt" ASC LIMIT ${RETENTION_BATCH_SIZE}
        )
      `,
      { deadlineAt, signal: context?.signal },
    );
    const candidatesRemain = await runBatchedRetention(
      () => prisma.$executeRaw`
        DELETE FROM "CanvasThumbnailCandidate" WHERE "id" IN (
          SELECT "id" FROM "CanvasThumbnailCandidate" WHERE "createdAt" < ${candidateCutoff}
          ORDER BY "createdAt" ASC LIMIT ${RETENTION_BATCH_SIZE}
        )
      `,
      { deadlineAt, signal: context?.signal },
    );
    if (keysRemain || candidatesRemain) await enqueueContinuation(prisma, job);
  };
}
