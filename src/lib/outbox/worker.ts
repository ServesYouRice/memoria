import { nanoid } from "nanoid";
import type { PrismaClient } from "@/generated/prisma/client";
import { createLogger } from "@/lib/logger";
import {
  claimOutboxJobs,
  completeOutboxJob,
  failOutboxJob,
  renewOutboxLease,
} from "./repository";
import type { OutboxHandlers } from "./types";
import { incrementOperationalCounter } from "@/lib/operations/runtime-metrics";

const logger = createLogger("outbox-worker");

export class OutboxHandlerTimeoutError extends Error {
  readonly retryable = true;

  constructor(timeoutMs: number) {
    super(`Outbox handler exceeded its ${timeoutMs}ms deadline`);
    this.name = "OutboxHandlerTimeoutError";
  }
}

export class OutboxLeaseLostError extends Error {
  readonly retryable = true;

  constructor() {
    super("Outbox job lease ownership was lost");
    this.name = "OutboxLeaseLostError";
  }
}

async function waitForNextPoll(signal: AbortSignal, pollMs: number) {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, pollMs);
    signal.addEventListener("abort", done, { once: true });
  });
}

export async function runOutboxWorker(options: {
  prisma: PrismaClient;
  handlers: OutboxHandlers;
  signal: AbortSignal;
  pollMs?: number;
  batchSize?: number;
  leaseMs?: number;
  handlerTimeoutMs?: number;
  handlerTimeoutMsByType?: Record<string, number>;
  concurrency?: number;
  owner?: string;
}) {
  const owner = options.owner || `worker-${nanoid(10)}`;
  const pollMs = options.pollMs || 1000;
  const leaseMs = options.leaseMs || 30_000;
  const handlerTimeoutMs = options.handlerTimeoutMs || 15_000;
  const concurrency = Math.max(1, options.concurrency || 4);
  const claimLimit = Math.min(
    Math.max(1, options.batchSize || concurrency),
    concurrency,
  );

  if (leaseMs <= handlerTimeoutMs) {
    throw new Error("Outbox lease must be longer than the handler deadline");
  }

  const processJob = async (
    job: Awaited<ReturnType<typeof claimOutboxJobs>>[number],
  ) => {
    const controller = new AbortController();
    const jobTimeoutMs =
      options.handlerTimeoutMsByType?.[job.type] || handlerTimeoutMs;
    const deadlineAt = new Date(Date.now() + jobTimeoutMs);
    let leaseLost = false;
    let renewalInFlight: Promise<void> | null = null;
    const timeout = setTimeout(() => {
      incrementOperationalCounter("outbox_handler_timeouts_total");
      controller.abort(new OutboxHandlerTimeoutError(jobTimeoutMs));
    }, jobTimeoutMs);
    timeout.unref?.();

    const renewal = setInterval(
      () => {
        if (renewalInFlight || leaseLost || controller.signal.aborted) return;
        renewalInFlight = renewOutboxLease(
          options.prisma,
          job.id,
          owner,
          leaseMs,
        )
          .then((renewed) => {
            if (renewed) return;
            leaseLost = true;
            incrementOperationalCounter("outbox_lease_lost_total");
            controller.abort(new OutboxLeaseLostError());
          })
          .catch(() => {
            leaseLost = true;
            incrementOperationalCounter("outbox_lease_lost_total");
            controller.abort(new OutboxLeaseLostError());
          })
          .finally(() => {
            renewalInFlight = null;
          });
      },
      Math.max(250, Math.floor(leaseMs / 3)),
    );
    renewal.unref?.();

    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        "abort",
        () =>
          reject(
            controller.signal.reason instanceof Error
              ? controller.signal.reason
              : new Error("Outbox handler aborted"),
          ),
        { once: true },
      );
    });

    try {
      await Promise.race([
        options.handlers[job.type]!(job, {
          signal: controller.signal,
          deliveryId: job.id,
          deadlineAt,
        }),
        aborted,
      ]);
      clearTimeout(timeout);
      clearInterval(renewal);
      await renewalInFlight;
      if (leaseLost) return;
      const completed = await completeOutboxJob(options.prisma, job.id, owner);
      if (!completed) {
        incrementOperationalCounter("outbox_lease_lost_total");
        logger.warn(
          { jobId: job.id, type: job.type, owner },
          "Outbox completion lost lease ownership",
        );
        return;
      }
      logger.info(
        { jobId: job.id, type: job.type, attempts: job.attempts },
        "Outbox job completed",
      );
    } catch (error) {
      clearInterval(renewal);
      await renewalInFlight;
      if (leaseLost || error instanceof OutboxLeaseLostError) {
        logger.warn(
          { jobId: job.id, type: job.type, owner },
          "Outbox handler stopped after lease loss",
        );
        return;
      }
      const failed = await failOutboxJob(options.prisma, job, owner, error);
      if (!failed) {
        incrementOperationalCounter("outbox_lease_lost_total");
        logger.warn(
          { jobId: job.id, type: job.type, owner },
          "Outbox failure could not update a job no longer owned",
        );
        return;
      }
      logger.warn(
        { jobId: job.id, type: job.type, attempts: job.attempts, error },
        "Outbox job failed",
      );
    } finally {
      clearTimeout(timeout);
      clearInterval(renewal);
    }
  };

  while (!options.signal.aborted) {
    let jobs: Awaited<ReturnType<typeof claimOutboxJobs>>;
    try {
      jobs = await claimOutboxJobs(options.prisma, {
        owner,
        limit: claimLimit,
        leaseMs,
        types: Object.keys(options.handlers),
      });
    } catch (error) {
      incrementOperationalCounter("outbox_poll_failures_total");
      logger.warn({ error, owner }, "Outbox claim failed");
      await waitForNextPoll(options.signal, pollMs);
      continue;
    }

    await Promise.all(jobs.map(processJob));
    if (jobs.length === 0) {
      await waitForNextPoll(options.signal, pollMs);
    }
  }
}
