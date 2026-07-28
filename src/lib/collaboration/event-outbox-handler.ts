import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { OutboxHandler } from "@/lib/outbox/types";
import { getRedisClient } from "@/lib/cache/redis-client";
import { toCommittedEventEnvelope } from "./committed-events";

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
    if (!event) return;
    await publish(
      `collaboration:canvas:${event.canvasId}`,
      JSON.stringify({
        type: "event",
        canvasId: event.canvasId,
        instanceId: `outbox:${job.id}`,
        payload: toCommittedEventEnvelope(event),
        timestamp: Date.now(),
      }),
    );
  };
}
