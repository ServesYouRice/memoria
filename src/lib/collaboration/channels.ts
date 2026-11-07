import { redisChannel } from "@/lib/cache/redis-keys";

/**
 * Collaboration pub/sub channels, under REDIS_KEY_PREFIX (IMP-073). ioredis
 * `keyPrefix` does not apply to channels, so publishers and subscribers both
 * take the full name from here.
 */

const CANVAS_CHANNEL = "collaboration:canvas:";
const SYNC_DOCUMENTS_CHANNEL = "collaboration:sync:documents";

/** Presence, cursor and committed-event fan-out for one canvas. */
export function canvasChannel(canvasId: string): string {
  return redisChannel(`${CANVAS_CHANNEL}${canvasId}`);
}

/** The prefix every `canvasChannel()` starts with. */
export function canvasChannelPrefix(): string {
  return redisChannel(CANVAS_CHANNEL);
}

/** Sync-server replicas announce persisted document updates here. */
export function syncDocumentsChannel(): string {
  return redisChannel(SYNC_DOCUMENTS_CHANNEL);
}
