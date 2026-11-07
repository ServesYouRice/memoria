import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// IMP-073: one REDIS_KEY_PREFIX covers every key (ioredis keyPrefix) and
// every channel and SCAN pattern (explicit). tests/redis checks the same
// against a real Valkey under the shared cluster's ACL.

const redisConstructor = vi.hoisted(() => vi.fn());
vi.mock("ioredis", () => ({
  default: class {
    status = "ready";
    constructor(url: string, options: Record<string, unknown>) {
      redisConstructor(url, options);
    }
    on() {
      return this;
    }
    async quit() {}
  },
}));

import {
  DEFAULT_REDIS_KEY_PREFIX,
  parseRedisKeyPrefix,
  redisChannel,
  redisScanPattern,
} from "@/lib/cache/redis-keys";
import {
  canvasChannel,
  canvasChannelPrefix,
  syncDocumentsChannel,
} from "@/lib/collaboration/channels";

const originalPrefix = process.env.REDIS_KEY_PREFIX;
const originalUrl = process.env.REDIS_URL;

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  delete process.env.REDIS_KEY_PREFIX;
});

afterEach(() => {
  restore("REDIS_KEY_PREFIX", originalPrefix);
  restore("REDIS_URL", originalUrl);
});

describe("REDIS_KEY_PREFIX", () => {
  it("defaults to memoria: when unset or blank", () => {
    expect(DEFAULT_REDIS_KEY_PREFIX).toBe("memoria:");
    expect(parseRedisKeyPrefix(undefined)).toBe("memoria:");
    expect(parseRedisKeyPrefix("")).toBe("memoria:");
    expect(parseRedisKeyPrefix("   ")).toBe("memoria:");
  });

  it("accepts a literal namespace ending in a colon", () => {
    expect(parseRedisKeyPrefix("memoria-staging:")).toBe("memoria-staging:");
    expect(parseRedisKeyPrefix("tenant.a:memoria:")).toBe("tenant.a:memoria:");
  });

  it.each([
    "memoria", // no trailing colon: memoria* would also match memoriax
    "memoria*:", // glob characters would widen SCAN MATCH
    "memoria?:",
    "[m]emoria:",
    " memoria:",
    "memo ria:",
    ":",
    `${"m".repeat(64)}:`,
  ])("rejects %j", (value) => {
    expect(() => parseRedisKeyPrefix(value)).toThrow(/REDIS_KEY_PREFIX/);
  });

  it("prefixes channels and SCAN patterns, which ioredis keyPrefix skips", () => {
    expect(redisChannel("collaboration:probe")).toBe(
      "memoria:collaboration:probe",
    );
    expect(redisScanPattern("unfurl:*")).toBe("memoria:unfurl:*");
    process.env.REDIS_KEY_PREFIX = "memoria-staging:";
    expect(redisChannel("x")).toBe("memoria-staging:x");
    expect(redisScanPattern("unfurl:*")).toBe("memoria-staging:unfurl:*");
  });

  it("puts every collaboration channel under the prefix", () => {
    expect(canvasChannel("canvas-1")).toBe(
      "memoria:collaboration:canvas:canvas-1",
    );
    expect(canvasChannel("canvas-1").startsWith(canvasChannelPrefix())).toBe(
      true,
    );
    expect(syncDocumentsChannel()).toBe("memoria:collaboration:sync:documents");
    process.env.REDIS_KEY_PREFIX = "other:";
    expect(syncDocumentsChannel()).toBe("other:collaboration:sync:documents");
  });
});

describe("Redis client", () => {
  beforeEach(() => {
    vi.resetModules();
    redisConstructor.mockClear();
  });

  it("applies the prefix to every key through ioredis keyPrefix", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.REDIS_KEY_PREFIX = "memoria-test:";
    const { getRedisClient, closeRedisConnection } =
      await import("@/lib/cache/redis-client");
    expect(getRedisClient()).not.toBeNull();
    expect(redisConstructor).toHaveBeenCalledWith(
      "redis://localhost:6379",
      expect.objectContaining({ keyPrefix: "memoria-test:" }),
    );
    await closeRedisConnection();
  });

  it("defaults the keyPrefix to memoria:", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const { getRedisClient, closeRedisConnection } =
      await import("@/lib/cache/redis-client");
    getRedisClient();
    expect(redisConstructor).toHaveBeenCalledWith(
      "redis://localhost:6379",
      expect.objectContaining({ keyPrefix: "memoria:" }),
    );
    await closeRedisConnection();
  });

  it("creates no client with an invalid prefix", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.REDIS_KEY_PREFIX = "memoria*";
    const { getRedisClient } = await import("@/lib/cache/redis-client");
    expect(getRedisClient()).toBeNull();
    expect(redisConstructor).not.toHaveBeenCalled();
  });
});

describe("unfurl cache stats", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("counts with a prefixed SCAN across every cursor and never calls KEYS", async () => {
    const scan = vi
      .fn()
      .mockResolvedValueOnce(["7", ["memoria:unfurl:a", "memoria:unfurl:b"]])
      .mockResolvedValueOnce(["0", ["memoria:unfurl:c"]]);
    const keys = vi.fn();
    const info = vi.fn().mockResolvedValue("used_memory_human:1.00M\r\n");
    vi.doMock("@/lib/cache/redis-client", () => ({
      getRedisClient: () => ({ scan, keys, info }),
    }));
    const { getUnfurlCacheStats } = await import("@/lib/cache/unfurl-cache");

    expect(await getUnfurlCacheStats()).toEqual({
      totalKeys: 3,
      memoryUsage: "1.00M",
    });
    expect(scan).toHaveBeenNthCalledWith(
      1,
      "0",
      "MATCH",
      "memoria:unfurl:*",
      "COUNT",
      250,
    );
    expect(scan).toHaveBeenNthCalledWith(
      2,
      "7",
      "MATCH",
      "memoria:unfurl:*",
      "COUNT",
      250,
    );
    expect(keys).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/cache/redis-client");
  });
});
