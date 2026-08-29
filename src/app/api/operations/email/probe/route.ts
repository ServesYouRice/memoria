import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { hasInternalOperationsAccess } from "@/lib/operations/internal-auth";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";

export const dynamic = "force-dynamic";

const jobIdSchema = z.string().cuid();

function hidden() {
  return NextResponse.json({ status: "not_found" }, { status: 404 });
}

export async function POST(request: Request) {
  if (!hasInternalOperationsAccess(request)) return hidden();
  if (env.EMAIL_SENDER_VERIFIED !== "true" || !env.EMAIL_DELIVERY_PROBE_TO) {
    return NextResponse.json(
      { status: "configuration_incomplete" },
      { status: 503 },
    );
  }

  const job = await enqueueOutboxJob(prisma, {
    type: "email.delivery-probe",
    payload: { to: env.EMAIL_DELIVERY_PROBE_TO },
    maxAttempts: 3,
  });

  return NextResponse.json(
    { jobId: job.id, status: job.status },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  if (!hasInternalOperationsAccess(request)) return hidden();
  const parsedJobId = jobIdSchema.safeParse(
    new URL(request.url).searchParams.get("jobId"),
  );
  if (!parsedJobId.success) {
    return NextResponse.json({ status: "invalid_request" }, { status: 400 });
  }

  const job = await prisma.outboxJob.findFirst({
    where: { id: parsedJobId.data, type: "email.delivery-probe" },
    select: {
      id: true,
      status: true,
      attempts: true,
      maxAttempts: true,
      lastError: true,
      completedAt: true,
      updatedAt: true,
    },
  });
  if (!job) return hidden();

  return NextResponse.json(job, {
    headers: { "Cache-Control": "no-store" },
  });
}
