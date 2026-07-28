import type { OutboxJob } from "@prisma/client";

export type OutboxHandler = (job: OutboxJob) => Promise<void>;
export type OutboxHandlers = Record<string, OutboxHandler>;

export interface EnqueueOutboxInput {
  type: string;
  payload: Record<string, unknown>;
  dedupeKey?: string;
  maxAttempts?: number;
  nextRunAt?: Date;
}
