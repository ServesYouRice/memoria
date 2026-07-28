import type { Prisma, PrismaClient } from "@prisma/client";
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
