import type { OutboxJob, PrismaClient } from "@/generated/prisma/client";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";
import { pruneCompletedOutboxJobs } from "@/lib/outbox/repository";
import type { OutboxHandler, OutboxHandlerContext } from "@/lib/outbox/types";
import {
  LAUNCH_LIMITS,
  workspaceCheckpointRetention,
} from "@/lib/policy/launch-limits";

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

/**
 * COMPLETED outbox rows are kept this long, then pruned. A kept row is what
 * makes a repeated enqueue with the same dedupeKey a no-op, so the window
 * must outlast every date-scoped key: the longest is the weekly recap
 * (`recap.weekly-sweep:<week>`, `recap.weekly:<weekStart>:<user>`); daily
 * retention and version-history keys and bookmark refresh buckets are
 * shorter. Keys built from a unique id (event, email, export, upload,
 * thumbnail revision, continuation) are never enqueued again.
 */
export const COMPLETED_OUTBOX_RETENTION_DAYS = 14;

/**
 * Job types whose dedupeKey names a long-lived entity, so the COMPLETED row
 * must stay: `board.propose:<item>` and `link.enrich:<item>` would run again
 * for an item that was already handled, and `upload.note:<asset>` is read
 * back as the note's status and re-armed in place.
 */
export const OUTBOX_PRUNE_KEEP_TYPES = [
  "board.propose",
  "link.enrich",
  "upload.note",
] as const;

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
    const checkpointsRemain = await pruneWorkspaceCheckpoints(prisma, {
      deadlineAt,
      signal: context?.signal,
    });
    const outboxCutoff = new Date(
      Date.now() - COMPLETED_OUTBOX_RETENTION_DAYS * 86_400_000,
    );
    const outboxRemain = await runBatchedRetention(
      () =>
        pruneCompletedOutboxJobs(prisma, {
          cutoff: outboxCutoff,
          keepTypes: OUTBOX_PRUNE_KEEP_TYPES,
          batchSize: RETENTION_BATCH_SIZE,
        }),
      { deadlineAt, signal: context?.signal },
    );
    if (keysRemain || candidatesRemain || checkpointsRemain || outboxRemain) {
      await enqueueContinuation(prisma, job);
    }
  };
}

/**
 * Prunes WorkspaceCheckpoint rows past the retention policy (see
 * workspaceCheckpointRetention): older than the age limit, or beyond the
 * newest maxPerScope of their (scopeType, scopeId). A checkpoint an open,
 * approved or executing bulk suggestion names is kept: running it requires
 * the checkpoint. Deleting only rows that violate the policy makes a rerun
 * a no-op. Returns whether work may remain.
 */
export async function pruneWorkspaceCheckpoints(
  prisma: PrismaClient,
  options: { deadlineAt: number; signal?: AbortSignal },
) {
  const { days, maxPerScope } = workspaceCheckpointRetention();
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const aged = await runBatchedRetention(
    () => prisma.$executeRaw`
      DELETE FROM "WorkspaceCheckpoint" WHERE "id" IN (
        SELECT checkpoint."id" FROM "WorkspaceCheckpoint" checkpoint
        WHERE checkpoint."createdAt" < ${cutoff}
          AND NOT EXISTS (
            SELECT 1 FROM "Suggestion" suggestion
            WHERE suggestion."status" IN ('OPEN', 'APPROVED', 'EXECUTING')
              AND suggestion."payload"->>'checkpointId' = checkpoint."id"
          )
        ORDER BY checkpoint."createdAt" ASC
        LIMIT ${RETENTION_BATCH_SIZE}
      )
    `,
    options,
  );
  const surplus = await runBatchedRetention(
    () => prisma.$executeRaw`
      WITH ranked AS (
        SELECT "id", ROW_NUMBER() OVER (
          PARTITION BY "scopeType", "scopeId" ORDER BY "createdAt" DESC, "id" DESC
        ) AS rank
        FROM "WorkspaceCheckpoint"
      ), doomed AS (
        SELECT ranked."id" FROM ranked
        WHERE ranked.rank > ${maxPerScope}
          AND NOT EXISTS (
            SELECT 1 FROM "Suggestion" suggestion
            WHERE suggestion."status" IN ('OPEN', 'APPROVED', 'EXECUTING')
              AND suggestion."payload"->>'checkpointId' = ranked."id"
          )
        LIMIT ${RETENTION_BATCH_SIZE}
      )
      DELETE FROM "WorkspaceCheckpoint" checkpoint USING doomed
      WHERE checkpoint."id" = doomed."id"
    `,
    options,
  );
  return aged || surplus;
}
