import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { z } from "zod";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";

type Store = Prisma.TransactionClient | PrismaClient;
export const committedEventEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: z.string().cuid(),
    cursor: z.string().regex(/^\d+$/),
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
  const event = await tx.canvasEvent.create({
    data: {
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
  const created = [];
  for (const input of events) {
    const event = await tx.canvasEvent.create({
      data: {
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
    created.push(event);
  }
  return created;
}

export function toCommittedEventEnvelope(event: {
  id: string;
  sequence: bigint;
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
