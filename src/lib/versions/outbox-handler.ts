/**
 * IMP-046 — outbox handlers behind the automatic version history.
 *
 * Both jobs are safe to run twice: a snapshot is only written under the canvas
 * lock when the canvas content differs from its latest version and that
 * version is old enough, and retention only deletes rows a fixed policy has
 * already condemned.
 *
 * @module lib/versions/outbox-handler
 */

import {
  CanvasVersionKind,
  type PrismaClient,
} from "@/generated/prisma/client";
import { ApiError } from "@/lib/errors";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import { createLogger } from "@/lib/logger";
import type { OutboxHandler } from "@/lib/outbox/types";
import { captureCanvasSnapshot } from "./snapshot";
import {
  AUTO_KEEP_ALL_MS,
  AUTO_KEEP_DAILY_MS,
  AUTO_KEEP_HOURLY_MS,
  AUTO_RETENTION_BATCH,
  AUTO_RETENTION_JOB,
  AUTO_RETENTION_MAX_ROUNDS,
  AUTO_SNAPSHOT_ACTIVITY_WINDOW_MS,
  AUTO_SNAPSHOT_BATCH,
  AUTO_SNAPSHOT_INTERVAL_MS,
  AUTO_SNAPSHOT_JOB,
  VERSION_JOB_RETENTION_MS,
  autoSnapshotName,
} from "./policy";

const logger = createLogger("version-history");

/** Time left in a handler's deadline that a sweep keeps in reserve. */
const DEADLINE_MARGIN_MS = 3_000;

export type AutoSnapshotOutcome =
  "created" | "recent" | "unchanged" | "empty" | "missing";

export interface AutoSnapshotOptions {
  now?: Date;
  intervalMs?: number;
}

/**
 * Take an automatic snapshot of one canvas if it changed since its latest
 * version and that version is at least `intervalMs` old. Serialized per canvas
 * by the mutation lock, so concurrent or repeated runs create at most one.
 */
export async function snapshotCanvasIfChanged(
  prisma: PrismaClient,
  canvasId: string,
  options: AutoSnapshotOptions = {},
): Promise<AutoSnapshotOutcome> {
  const now = options.now ?? new Date();
  const intervalMs = options.intervalMs ?? AUTO_SNAPSHOT_INTERVAL_MS;
  return prisma.$transaction(
    async (tx): Promise<AutoSnapshotOutcome> => {
      await lockCanvasForMutation(tx, canvasId);
      const latest = await tx.canvasVersion.findFirst({
        where: { canvasId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { createdAt: true, contentHash: true },
      });
      if (latest && now.getTime() - latest.createdAt.getTime() < intervalMs) {
        return "recent";
      }
      const exists = await tx.canvas.count({ where: { id: canvasId } });
      if (!exists) return "missing";
      const captured = await captureCanvasSnapshot(tx, canvasId);
      if (latest ? latest.contentHash === captured.contentHash : false) {
        return "unchanged";
      }
      // A canvas nobody has put anything on has nothing worth keeping.
      if (!latest && captured.itemCount === 0) return "empty";
      await tx.canvasVersion.create({
        data: {
          canvasId,
          kind: CanvasVersionKind.AUTO,
          name: autoSnapshotName(now),
          snapshot: captured.snapshot,
          yjsState: captured.yjsState,
          contentHash: captured.contentHash,
          createdAt: now,
        },
      });
      return "created";
    },
    { maxWait: 5_000, timeout: 15_000 },
  );
}

/**
 * Canvases that changed after their latest version, whose latest version is
 * old enough for another one. The test is cheap and may over-approximate
 * (`snapshotCanvasIfChanged` compares content); random order keeps a canvas
 * that never succeeds from starving the others.
 */
export async function findAutoSnapshotCandidates(
  prisma: PrismaClient,
  options: {
    now?: Date;
    intervalMs?: number;
    activityWindowMs?: number;
    limit?: number;
  } = {},
): Promise<string[]> {
  const now = options.now ?? new Date();
  const dueBefore = new Date(
    now.getTime() - (options.intervalMs ?? AUTO_SNAPSHOT_INTERVAL_MS),
  );
  const windowStart = new Date(
    now.getTime() -
      (options.activityWindowMs ?? AUTO_SNAPSHOT_ACTIVITY_WINDOW_MS),
  );
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT canvas."id"
    FROM "Canvas" canvas
    LEFT JOIN LATERAL (
      SELECT version."createdAt"
      FROM "CanvasVersion" version
      WHERE version."canvasId" = canvas."id"
      ORDER BY version."createdAt" DESC
      LIMIT 1
    ) latest ON TRUE
    CROSS JOIN LATERAL (
      SELECT GREATEST(
        COALESCE(latest."createdAt", ${windowStart}::timestamp),
        ${windowStart}::timestamp
      ) AS "since"
    ) change
    WHERE (latest."createdAt" IS NULL OR latest."createdAt" <= ${dueBefore}::timestamp)
      AND (
        EXISTS (
          SELECT 1 FROM "CanvasItem" item
          WHERE item."canvasId" = canvas."id" AND item."updatedAt" > change."since"
        )
        OR EXISTS (
          SELECT 1 FROM "CanvasDocument" document
          WHERE document."canvasId" = canvas."id" AND document."updatedAt" > change."since"
        )
        OR EXISTS (
          SELECT 1 FROM "CanvasDocumentUpdate" change_update
          WHERE change_update."canvasId" = canvas."id" AND change_update."createdAt" > change."since"
        )
      )
    ORDER BY random()
    LIMIT ${options.limit ?? AUTO_SNAPSHOT_BATCH}
  `;
  return rows.map((row) => row.id);
}

export interface AutoSnapshotSweepResult {
  candidates: number;
  created: number;
  skipped: number;
  failed: number;
}

export async function runAutoSnapshotSweep(
  prisma: PrismaClient,
  options: {
    now?: Date;
    intervalMs?: number;
    activityWindowMs?: number;
    limit?: number;
    /** Stop starting new canvases at this time; the rest wait for the next sweep. */
    stopAt?: number;
  } = {},
): Promise<AutoSnapshotSweepResult> {
  const result: AutoSnapshotSweepResult = {
    candidates: 0,
    created: 0,
    skipped: 0,
    failed: 0,
  };
  const candidates = await findAutoSnapshotCandidates(prisma, options);
  result.candidates = candidates.length;
  for (const canvasId of candidates) {
    if (options.stopAt !== undefined && Date.now() >= options.stopAt) break;
    try {
      const outcome = await snapshotCanvasIfChanged(prisma, canvasId, options);
      if (outcome === "created") result.created += 1;
      else result.skipped += 1;
    } catch (error) {
      // One canvas (say, one over the snapshot limit) must not hold up the rest.
      result.failed += 1;
      logger.warn(
        {
          canvasId,
          error: error instanceof Error ? error.message : "unknown error",
          ...(error instanceof ApiError ? { status: error.status } : {}),
        },
        "Automatic snapshot failed",
      );
    }
  }
  return result;
}

export function createAutoSnapshotHandler(
  prisma: PrismaClient,
  defaults: { intervalMs?: number } = {},
): OutboxHandler {
  return async (_job, context) => {
    const result = await runAutoSnapshotSweep(prisma, {
      intervalMs: defaults.intervalMs,
      stopAt: context
        ? context.deadlineAt.getTime() - DEADLINE_MARGIN_MS
        : undefined,
    });
    logger.info(result, "Automatic snapshot sweep finished");
  };
}

/**
 * Thin out automatic snapshots. Each canvas keeps every automatic snapshot of
 * the last 24 hours, then the earliest of each hour for 7 days, then the
 * earliest of each UTC day for 30 days; older ones go. "Earliest of its
 * bucket" never changes as time passes, so repeated runs converge and agree.
 * Manual versions are not selected at all.
 */
export async function deleteExpiredAutoVersions(
  prisma: PrismaClient,
  options: { now?: Date; batch?: number; maxRounds?: number } = {},
): Promise<number> {
  const now = (options.now ?? new Date()).getTime();
  const batch = options.batch ?? AUTO_RETENTION_BATCH;
  const keepAllCutoff = new Date(now - AUTO_KEEP_ALL_MS);
  const hourlyCutoff = new Date(now - AUTO_KEEP_HOURLY_MS);
  const dailyCutoff = new Date(now - AUTO_KEEP_DAILY_MS);
  let deleted = 0;
  for (let round = 0; round < (options.maxRounds ?? 10); round += 1) {
    // Ranking only the rows older than the keep-all window cannot change a
    // bucket's earliest row: that row is older than every other row in it.
    const count = await prisma.$executeRaw`
      WITH ranked AS (
        SELECT version."id", version."createdAt",
          ROW_NUMBER() OVER (
            PARTITION BY version."canvasId", date_trunc('hour', version."createdAt")
            ORDER BY version."createdAt", version."id"
          ) AS hour_rank,
          ROW_NUMBER() OVER (
            PARTITION BY version."canvasId", date_trunc('day', version."createdAt")
            ORDER BY version."createdAt", version."id"
          ) AS day_rank
        FROM "CanvasVersion" version
        WHERE version."kind" = 'AUTO' AND version."createdAt" < ${keepAllCutoff}
      ), doomed AS (
        SELECT "id" FROM ranked
        WHERE "createdAt" < ${dailyCutoff}
          OR ("createdAt" < ${hourlyCutoff} AND day_rank > 1)
          OR hour_rank > 1
        ORDER BY "createdAt", "id"
        LIMIT ${batch}
      )
      DELETE FROM "CanvasVersion" version USING doomed WHERE version."id" = doomed."id"
    `;
    deleted += count;
    if (count < batch) break;
  }
  return deleted;
}

/** Finished sweeps are only bookkeeping; drop them once their dedupe window passed. */
export async function pruneFinishedVersionJobs(
  prisma: PrismaClient,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - VERSION_JOB_RETENTION_MS);
  return prisma.$executeRaw`
    DELETE FROM "OutboxJob" WHERE "id" IN (
      SELECT "id" FROM "OutboxJob"
      WHERE "type" IN (${AUTO_SNAPSHOT_JOB}, ${AUTO_RETENTION_JOB})
        AND "status" = 'COMPLETED' AND "completedAt" < ${cutoff}
      ORDER BY "completedAt" ASC LIMIT 500
    )
  `;
}

export function createAutoRetentionHandler(
  prisma: PrismaClient,
): OutboxHandler {
  return async () => {
    const versions = await deleteExpiredAutoVersions(prisma, {
      maxRounds: AUTO_RETENTION_MAX_ROUNDS,
    });
    const jobs = await pruneFinishedVersionJobs(prisma);
    logger.info({ versions, jobs }, "Automatic version retention finished");
  };
}
