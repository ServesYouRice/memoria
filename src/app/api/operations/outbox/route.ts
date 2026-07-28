import { NextResponse } from "next/server";
import { OutboxJobStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hasInternalOperationsAccess } from "@/lib/operations/internal-auth";
import { replayDeadOutboxJob } from "@/lib/outbox/repository";

const actionSchema = z
  .object({
    action: z.enum(["replay", "cancel"]),
    jobId: z.string().cuid(),
  })
  .strict();

function hidden() {
  return NextResponse.json({ status: "not_found" }, { status: 404 });
}

export async function GET(request: Request) {
  if (!hasInternalOperationsAccess(request)) return hidden();
  const url = new URL(request.url);
  const status = z
    .nativeEnum(OutboxJobStatus)
    .optional()
    .parse(url.searchParams.get("status") || undefined);
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .parse(url.searchParams.get("limit") || undefined);
  const jobs = await prisma.outboxJob.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      status: true,
      attempts: true,
      maxAttempts: true,
      nextRunAt: true,
      lastError: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json(
    { jobs },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!hasInternalOperationsAccess(request)) return hidden();
  const input = actionSchema.parse(await request.json());
  const result =
    input.action === "replay"
      ? await replayDeadOutboxJob(prisma, input.jobId)
      : await prisma.outboxJob.updateMany({
          where: {
            id: input.jobId,
            status: { in: [OutboxJobStatus.PENDING, OutboxJobStatus.RUNNING] },
          },
          data: {
            status: OutboxJobStatus.DEAD,
            leaseOwner: null,
            leaseExpiresAt: null,
            lastError: "Cancelled by operator.",
          },
        });
  return NextResponse.json({ updated: result.count === 1 });
}
