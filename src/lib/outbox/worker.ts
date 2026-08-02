import { nanoid } from "nanoid";
import type { PrismaClient } from "@/generated/prisma/client";
import { createLogger } from "@/lib/logger";
import {
  claimOutboxJobs,
  completeOutboxJob,
  failOutboxJob,
} from "./repository";
import type { OutboxHandlers } from "./types";

const logger = createLogger("outbox-worker");

export async function runOutboxWorker(options: {
  prisma: PrismaClient;
  handlers: OutboxHandlers;
  signal: AbortSignal;
  pollMs?: number;
  batchSize?: number;
  leaseMs?: number;
  owner?: string;
}) {
  const owner = options.owner || `worker-${nanoid(10)}`;
  const pollMs = options.pollMs || 1000;
  while (!options.signal.aborted) {
    const jobs = await claimOutboxJobs(options.prisma, {
      owner,
      limit: options.batchSize || 20,
      leaseMs: options.leaseMs || 60_000,
      types: Object.keys(options.handlers),
    });
    for (const job of jobs) {
      try {
        await options.handlers[job.type]!(job);
        await completeOutboxJob(options.prisma, job.id, owner);
        logger.info(
          { jobId: job.id, type: job.type, attempts: job.attempts },
          "Outbox job completed",
        );
      } catch (error) {
        await failOutboxJob(options.prisma, job, owner, error);
        logger.warn(
          { jobId: job.id, type: job.type, attempts: job.attempts, error },
          "Outbox job failed",
        );
      }
    }
    if (jobs.length === 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, pollMs);
        options.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
  }
}
