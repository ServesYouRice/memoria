import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { EnqueueOutboxInput } from "./types";

type TransactionClient = Prisma.TransactionClient | PrismaClient;
const SECRET_KEY = /(password|secret|token|authorization|cookie|api[-_]?key)/i;

export function assertSafeOutboxPayload(
  value: unknown,
  path = "payload",
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertSafeOutboxPayload(entry, `${path}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      throw new Error(
        `Outbox payload may not contain secret field ${path}.${key}`,
      );
    }
    assertSafeOutboxPayload(entry, `${path}.${key}`);
  }
}

export async function enqueueOutboxJob(
  tx: TransactionClient,
  input: EnqueueOutboxInput,
) {
  assertSafeOutboxPayload(input.payload);
  const data = {
    type: input.type,
    payload: input.payload as Prisma.InputJsonValue,
    dedupeKey: input.dedupeKey,
    maxAttempts: input.maxAttempts,
    nextRunAt: input.nextRunAt,
  };
  if (!input.dedupeKey) return tx.outboxJob.create({ data });
  return tx.outboxJob.upsert({
    where: { dedupeKey: input.dedupeKey },
    create: data,
    update: {},
  });
}

/**
 * Enqueue many jobs with one statement. Keyed jobs keep `enqueueOutboxJob`'s
 * upsert-with-empty-update semantics: an existing dedupeKey is left untouched.
 */
export async function enqueueOutboxJobs(
  tx: TransactionClient,
  inputs: EnqueueOutboxInput[],
) {
  if (inputs.length === 0) return;
  for (const input of inputs) assertSafeOutboxPayload(input.payload);
  await tx.outboxJob.createMany({
    data: inputs.map((input) => ({
      type: input.type,
      payload: input.payload as Prisma.InputJsonValue,
      dedupeKey: input.dedupeKey,
      maxAttempts: input.maxAttempts,
      nextRunAt: input.nextRunAt,
    })),
    skipDuplicates: true,
  });
}
