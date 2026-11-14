import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { OutboxHandler } from "@/lib/outbox/types";
import { getRedisClient } from "@/lib/cache/redis-client";
import { canvasChannel } from "./channels";
import { toCommittedEventEnvelope } from "./committed-events";
import {
  placementCanvasIds,
  publishPlacementChanged,
} from "@/lib/placements/placements";

const payloadSchema = z.object({ eventId: z.string().cuid() }).strict();

export function createCanvasEventHandler(
  prisma: PrismaClient,
  publish: (channel: string, message: string) => Promise<unknown> = async (
    channel,
    message,
  ) => {
    const redis = getRedisClient();
    if (!redis)
      throw new Error("Redis is unavailable for committed event fanout.");
    return redis.publish(channel, message);
  },
): OutboxHandler {
  return async (job) => {
    const { eventId } = payloadSchema.parse(job.payload);
    const event = await prisma.canvasEvent.findUnique({
      where: { id: eventId },
    });
    // Restores fan out through createCanvasRestoreEventHandler.
    if (!event || event.operation === "restored") return;
    await publish(
      canvasChannel(event.canvasId),
      JSON.stringify({
        type: "event",
        canvasId: event.canvasId,
        instanceId: `outbox:${job.id}`,
        payload: toCommittedEventEnvelope(event),
        timestamp: Date.now(),
      }),
    );
    // IMP-109: canvases that also show this item read it again.
    const elsewhere = await placementCanvasIds(prisma, event.entityId);
    if (elsewhere.length > 0)
      await publishPlacementChanged(elsewhere, event.entityId, publish);
  };
}

export function createCanvasRestoreEventHandler(
  prisma: PrismaClient,
  publish: (channel: string, message: string) => Promise<unknown> = async (
    channel,
    message,
  ) => {
    const redis = getRedisClient();
    if (!redis) throw new Error("Redis is unavailable for restore fanout.");
    return redis.publish(channel, message);
  },
): OutboxHandler {
  return async (job) => {
    const { eventId } = payloadSchema.parse(job.payload);
    const event = await prisma.canvasEvent.findUnique({
      where: { id: eventId },
    });
    if (!event || event.operation !== "restored") return;
    await publish(
      canvasChannel(event.canvasId),
      JSON.stringify({
        type: "message",
        canvasId: event.canvasId,
        payload: {
          type: "canvas-restore-required",
          restoreRevision: event.entityVersion,
          cursor: event.sequence.toString(),
        },
        instanceId: `outbox:${job.id}`,
        timestamp: Date.now(),
      }),
    );
    // IMP-109: items of this canvas shown elsewhere may have changed too.
    const shown = await prisma.itemPlacement.findMany({
      where: { item: { canvasId: event.canvasId } },
      select: { canvasId: true },
      distinct: ["canvasId"],
    });
    if (shown.length > 0)
      await publishPlacementChanged(
        shown.map((row) => row.canvasId),
        `restore:${event.canvasId}`,
        publish,
      );
  };
}
