/**
 * One namespace for every Redis key and pub/sub channel (IMP-073).
 *
 * The shared Valkey grants Memoria's ACL user only `~memoria:*` (keys) and
 * `&memoria:*` (channels). The client in `redis-client.ts` applies the prefix
 * to every key through ioredis `keyPrefix`, Lua `KEYS` included. ioredis does
 * not prefix pub/sub channels or `SCAN MATCH` patterns, so those go through
 * `redisChannel()` and `redisScanPattern()` here. Callers name keys without
 * the prefix.
 */

export const DEFAULT_REDIS_KEY_PREFIX = "memoria:";

/**
 * Letters, digits and `_.:-`, ending in `:`. No glob characters, so the
 * prefix is literal inside an ACL pattern or a `SCAN MATCH`.
 */
export const REDIS_KEY_PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,62}:$/;

export function parseRedisKeyPrefix(value: string | undefined): string {
  // Blank means unset, as in env.ts; anything else must match exactly.
  const prefix = value?.trim() ? value : DEFAULT_REDIS_KEY_PREFIX;
  if (!REDIS_KEY_PREFIX_PATTERN.test(prefix)) {
    throw new Error(
      "REDIS_KEY_PREFIX must be 2-64 letters, digits, '_', '.', ':' or '-' and end with ':'.",
    );
  }
  return prefix;
}

export function getRedisKeyPrefix(): string {
  return parseRedisKeyPrefix(process.env["REDIS_KEY_PREFIX"]);
}

/** A pub/sub channel under the prefix; use for PUBLISH and SUBSCRIBE alike. */
export function redisChannel(name: string): string {
  return `${getRedisKeyPrefix()}${name}`;
}

/** A `SCAN MATCH` pattern under the prefix; keys it returns carry the prefix. */
export function redisScanPattern(pattern: string): string {
  return `${getRedisKeyPrefix()}${pattern}`;
}
