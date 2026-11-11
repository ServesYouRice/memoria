import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { z } from "zod";
import { enqueueOutboxJob, enqueueOutboxJobs } from "@/lib/outbox/enqueue";

type Store = Prisma.TransactionClient | PrismaClient;
export const committedEventEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: z.string().cuid(),
    cursor: z.string().regex(/^\d+$/),
    // The event's contiguous per-canvas number: a client that last applied
    // number n has missed nothing when the next one is n + 1. Absent on
    // events recorded without one.
    canvasCursor: z.string().regex(/^\d+$/).optional(),
    canvasId: z.string().cuid(),
    actorId: z.string().min(1),
    entity: z.object({
      type: z.literal("canvas-item"),
      id: z.string().cuid(),
      version: z.number().int().positive(),
    }),
    operation: z.enum(["created", "updated", "deleted"]),
    permissionScope: z.literal("VIEW"),
    committedAt: z.string().datetime(),
  })
  .strict();

/**
 * Hand out `count` contiguous per-canvas event numbers and return the first.
 * The row lock this UPDATE takes is held until commit, so one canvas's event
 * inserts are serialized: per canvas, both `canvasSequence` and the global
 * `sequence` (taken after the lock) follow commit order. A rolled-back
 * transaction returns its numbers, so no per-canvas hole is left.
 */
async function allocateCanvasEventSequences(
  tx: Store,
  canvasId: string,
  count = 1,
): Promise<bigint> {
  const rows = await tx.$queryRaw<Array<{ last: bigint }>>`
    UPDATE "Canvas" SET "eventSequence" = "eventSequence" + ${count}
    WHERE "id" = ${canvasId}
    RETURNING "eventSequence" AS "last"
  `;
  const last = rows[0]?.last;
  if (last === undefined)
    throw new Error(`Cannot record an event for missing canvas ${canvasId}`);
  return BigInt(last) - BigInt(count) + 1n;
}

export async function recordCanvasItemEvent(
  tx: Store,
  input: {
    canvasId: string;
    actorId: string;
    itemId: string;
    version: number;
    operation: "created" | "updated" | "deleted";
  },
) {
  const canvasSequence = await allocateCanvasEventSequences(tx, input.canvasId);
  const event = await tx.canvasEvent.create({
    data: {
      canvasSequence,
      canvasId: input.canvasId,
      actorId: input.actorId,
      entityId: input.itemId,
      entityVersion: input.version,
      operation: input.operation,
    },
  });
  await enqueueOutboxJob(tx, {
    type: "canvas.event.publish",
    payload: { eventId: event.id },
    dedupeKey: `canvas.event.publish:${event.id}`,
  });
  return event;
}

export async function recordCanvasItemEventsBatch(
  tx: Store,
  events: Array<{
    canvasId: string;
    actorId: string;
    itemId: string;
    version: number;
    operation: "created" | "updated" | "deleted";
  }>,
) {
  if (events.length === 0) return [];
  // One counter update per canvas, taken in id order so concurrent batches
  // over the same canvases cannot deadlock.
  const counts = new Map<string, number>();
  for (const input of events)
    counts.set(input.canvasId, (counts.get(input.canvasId) ?? 0) + 1);
  const next = new Map<string, bigint>();
  for (const canvasId of Array.from(counts.keys()).sort())
    next.set(
      canvasId,
      await allocateCanvasEventSequences(tx, canvasId, counts.get(canvasId)),
    );
  // Then one INSERT ... RETURNING for the events (rows come back in input
  // order) and one for their publish jobs.
  const created = await tx.canvasEvent.createManyAndReturn({
    data: events.map((input) => {
      const canvasSequence = next.get(input.canvasId)!;
      next.set(input.canvasId, canvasSequence + 1n);
      return {
        canvasSequence,
        canvasId: input.canvasId,
        actorId: input.actorId,
        entityId: input.itemId,
        entityVersion: input.version,
        operation: input.operation,
      };
    }),
  });
  await enqueueOutboxJobs(
    tx,
    created.map((event) => ({
      type: "canvas.event.publish",
      payload: { eventId: event.id },
      dedupeKey: `canvas.event.publish:${event.id}`,
    })),
  );
  return created;
}

export function toCommittedEventEnvelope(event: {
  id: string;
  sequence: bigint;
  canvasSequence?: bigint | null;
  canvasId: string;
  actorId: string;
  entityId: string;
  entityVersion: number;
  operation: string;
  permissionScope: string;
  schemaVersion: number;
  createdAt: Date;
}) {
  return committedEventEnvelopeSchema.parse({
    schemaVersion: event.schemaVersion,
    eventId: event.id,
    cursor: event.sequence.toString(),
    ...(event.canvasSequence == null
      ? {}
      : { canvasCursor: event.canvasSequence.toString() }),
    canvasId: event.canvasId,
    actorId: event.actorId,
    entity: {
      type: "canvas-item",
      id: event.entityId,
      version: event.entityVersion,
    },
    operation: event.operation,
    permissionScope: event.permissionScope,
    committedAt: event.createdAt.toISOString(),
  });
}
