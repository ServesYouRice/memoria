import type { OutboxJob } from "@/generated/prisma/client";

export interface OutboxHandlerContext {
  signal: AbortSignal;
  deliveryId: string;
  deadlineAt: Date;
}

export type OutboxHandler = (
  job: OutboxJob,
  context?: OutboxHandlerContext,
) => Promise<void>;
export type OutboxHandlers = Record<string, OutboxHandler>;

export interface EnqueueOutboxInput {
  type: string;
  payload: Record<string, unknown>;
  dedupeKey?: string;
  maxAttempts?: number;
  nextRunAt?: Date;
}
