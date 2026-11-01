import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withApiHandler } from "@/lib/api/route-handler";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";
import { InternalServerError, UnauthorizedError } from "@/lib/errors";
import {
  AUTO_RETENTION_JOB,
  AUTO_SNAPSHOT_JOB,
  autoRetentionDedupeKey,
  autoSnapshotDedupeKey,
} from "@/lib/versions/policy";

/**
 * IMP-046 — queues the automatic snapshot sweep (one per five-minute bucket)
 * and the automatic version thinning (one per hour). The scheduler calls this
 * on a short interval; repeated calls inside a bucket are deduplicated by the
 * outbox, and the jobs themselves are idempotent.
 */
export const GET = withApiHandler(async (request: NextRequest) => {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) throw new InternalServerError("Cron secret not configured");
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    throw new UnauthorizedError("Invalid cron secret");
  }
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await enqueueOutboxJob(tx, {
      type: AUTO_SNAPSHOT_JOB,
      payload: {},
      dedupeKey: autoSnapshotDedupeKey(now),
      maxAttempts: 3,
    });
    await enqueueOutboxJob(tx, {
      type: AUTO_RETENTION_JOB,
      payload: {},
      dedupeKey: autoRetentionDedupeKey(now),
      maxAttempts: 3,
    });
  });
  return NextResponse.json({ queued: true });
});
