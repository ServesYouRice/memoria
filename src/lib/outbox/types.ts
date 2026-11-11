import type { OutboxJob } from "@/generated/prisma/client";

/**
 * Thrown by a handler that cannot run yet: the worker puts the job back to
 * PENDING until `retryAt` without consuming an attempt.
 */
export class OutboxDeferError extends Error {
  readonly retryable = true;

  constructor(
    readonly retryAt: Date,
    readonly reason = "Deferred by its handler",
  ) {
    super(`Outbox job deferred until ${retryAt.toISOString()}: ${reason}`);
    this.name = "OutboxDeferError";
  }
}

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
