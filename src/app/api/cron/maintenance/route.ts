import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withApiHandler } from "@/lib/api/route-handler";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";
import { InternalServerError, UnauthorizedError } from "@/lib/errors";

export const GET = withApiHandler(async (request: NextRequest) => {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) throw new InternalServerError("Cron secret not configured");
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    throw new UnauthorizedError("Invalid cron secret");
  }
  const day = new Date().toISOString().slice(0, 10);
  await prisma.$transaction(async (tx) => {
    for (const type of [
      "retention.trash",
      "retention.versions",
      "retention.maintenance",
    ]) {
      await enqueueOutboxJob(tx, {
        type,
        payload: {},
        dedupeKey: `${type}:${day}`,
      });
    }
  });
  return NextResponse.json({ queued: true, day });
});
