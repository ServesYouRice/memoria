/**
 * IMP-073: Memoria against a real Redis/Valkey whose app user may touch only
 * keys `~memoria:*` and channels `&memoria:*` (the shared cluster's ACL, see
 * scripts/test-redis.mjs). Most callers swallow Redis errors and fall back to
 * process memory, so each test also asserts, as the admin user, that the ACL
 * log stayed empty and that every key landed under the prefix.
 */
import Redis from "ioredis";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { closeRedisConnection, getRedisClient } from "@/lib/cache/redis-client";
import { redisChannel } from "@/lib/cache/redis-keys";
import {
  getCachedUnfurl,
  getUnfurlCacheStats,
  invalidateUnfurlCache,
  setCachedUnfurl,
} from "@/lib/cache/unfurl-cache";
import {
  getCachedCanvas,
  invalidateCanvasCache,
  setCachedCanvas,
  type CanvasData,
} from "@/lib/cache/canvas-cache";
import {
  getCachedProxiedImage,
  setCachedProxiedImage,
} from "@/lib/cache/image-proxy-cache";
import { createRateLimiter } from "@/lib/rate-limit";
import { RedisRateLimitStore } from "@/lib/rate-limit/stores/redis";
import {
  clearFailedAttempts,
  recordFailedAttempt,
  resetInMemoryLockoutForTests,
} from "@/lib/auth/account-lockout";
import { resetAiBudgetForTests, runBudgetedAi } from "@/lib/ai/budget";
import {
  incrementOperationalCounter,
  readOperationalCounters,
  resetOperationalCountersForTests,
} from "@/lib/operations/runtime-metrics";
import { SharedConnectionAdmission } from "@/lib/collaboration/shared-admission";
import { createCanvasEventHandler } from "@/lib/collaboration/event-outbox-handler";
import {
  canvasChannel,
  syncDocumentsChannel,
} from "@/lib/collaboration/channels";

const appUrl = process.env.REDIS_ACL_TEST_URL;
const adminUrl = process.env.REDIS_ACL_ADMIN_URL;
if (!appUrl || !adminUrl) {
  throw new Error(
    "REDIS_ACL_TEST_URL and REDIS_ACL_ADMIN_URL are required; run `pnpm test:redis`.",
  );
}
// The modules under test read these lazily, on first use.
process.env.REDIS_URL = appUrl;
delete process.env.REDIS_KEY_PREFIX;

const PREFIX = "memoria:";
const admin = new Redis(adminUrl, { lazyConnect: true });

async function allKeys(): Promise<string[]> {
  const found: string[] = [];
  let cursor = "0";
  do {
    const [next, keys] = await admin.scan(cursor, "MATCH", "*", "COUNT", 500);
    found.push(...keys);
    cursor = next;
  } while (cursor !== "0");
  return found.sort();
}

async function aclDenials(): Promise<unknown[]> {
  return (await admin.call("ACL", "LOG")) as unknown[];
}

function app(): Redis {
  const client = getRedisClient();
  if (!client) throw new Error("Redis client was not created");
  return client;
}

/** Resolves with the first message on `channel`, from a subscriber like the servers'. */
async function nextMessage(
  subscriber: Redis,
  channel: string,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`No message on ${channel}`)),
      5_000,
    );
    subscriber.on("message", (received: string, message: string) => {
      if (received !== channel) return;
      clearTimeout(timer);
      resolvePromise(message);
    });
  });
}

const subscribers: Redis[] = [];

beforeAll(async () => {
  await admin.connect();
  await app().ping();
});

beforeEach(async () => {
  await admin.flushall();
  await admin.call("ACL", "LOG", "RESET");
  resetInMemoryLockoutForTests();
  resetAiBudgetForTests();
  resetOperationalCountersForTests();
});

afterEach(async () => {
  while (subscribers.length) await subscribers.pop()!.quit();
  expect(await aclDenials()).toEqual([]);
  for (const key of await allKeys()) expect(key.startsWith(PREFIX)).toBe(true);
});

afterAll(async () => {
  await closeRedisConnection();
  await admin.quit();
});

describe("Redis under the shared Valkey ACL (IMP-073)", () => {
  it("prefixes the client and leaves no unprefixed key reachable", async () => {
    expect(app().options.keyPrefix).toBe(PREFIX);
    await app().set("probe", "1");
    expect(await admin.get(`${PREFIX}probe`)).toBe("1");
    expect(await admin.exists("probe")).toBe(0);
  });

  it("counts rate limits in Redis under the prefix", async () => {
    const limiter = createRateLimiter({
      maxRequests: 2,
      windowSeconds: 60,
      keyPrefix: "acl-test",
    });
    const results = [];
    for (let i = 0; i < 3; i += 1) results.push(await limiter.check("client"));
    expect(results.map((result) => result.current)).toEqual([1, 2, 3]);
    expect(results.map((result) => result.allowed)).toEqual([
      true,
      true,
      false,
    ]);
    const keys = await allKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^memoria:ratelimit:acl-test/);
    expect(await admin.ttl(keys[0]!)).toBeGreaterThan(0);

    const store = new RedisRateLimitStore();
    expect(await store.ping()).toBe(true);
    await limiter.reset("client");
    expect(await allKeys()).toEqual([]);
  });

  it("reads, writes, scans and invalidates the caches", async () => {
    const url = "https://example.com/article?b=2&a=1";
    await setCachedUnfurl(url, { title: "Article" });
    expect(await getCachedUnfurl(url)).toEqual({ title: "Article" });
    // Stats SCAN with a prefixed MATCH (KEYS is refused) and read INFO.
    const stats = await getUnfurlCacheStats();
    expect(stats).not.toBeNull();
    expect(stats!.totalKeys).toBe(1);
    expect(stats!.memoryUsage).not.toBe("unknown");
    await invalidateUnfurlCache(url);
    expect(await getCachedUnfurl(url)).toBeNull();
    expect((await getUnfurlCacheStats())!.totalKeys).toBe(0);

    const canvas = { id: "canvas-1", name: "Board", items: [] };
    await setCachedCanvas(canvas as unknown as CanvasData);
    expect(await getCachedCanvas("canvas-1")).toEqual(canvas);
    expect(await admin.exists(`${PREFIX}canvas:canvas-1:data`)).toBe(1);
    await invalidateCanvasCache("canvas-1");
    expect(await getCachedCanvas("canvas-1")).toBeNull();

    const image = { contentType: "image/png", body: Buffer.from([1, 2, 3]) };
    await setCachedProxiedImage("https://example.com/a.png", image);
    expect(await getCachedProxiedImage("https://example.com/a.png")).toEqual(
      image,
    );
    const keys = await allKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^memoria:image-proxy:v1:/);
  });

  it("keeps login lockout, AI budgets and shared counters in Redis", async () => {
    const first = await recordFailedAttempt("user@example.com", "client-a");
    const second = await recordFailedAttempt("user@example.com", "client-a");
    expect([first.attempts, second.attempts]).toEqual([1, 2]);
    expect(
      (await allKeys()).filter((key) =>
        key.startsWith(`${PREFIX}auth:attempts:account:`),
      ),
    ).toHaveLength(2);
    await clearFailedAttempts("user@example.com", "client-a");
    expect(await allKeys()).toEqual([]);

    const { value, usage } = await runBudgetedAi(
      "user-1",
      { prompt: "hello", maxOutputTokens: 10 },
      async () => "ok",
    );
    expect(value).toBe("ok");
    expect(usage.requests).toBe(1);
    expect(usage.activeRequests).toBe(0);
    const budgetKeys = (await allKeys()).filter((key) =>
      key.startsWith(`${PREFIX}ai:budget:`),
    );
    expect(budgetKeys).toHaveLength(1);
    expect(budgetKeys[0]).toMatch(/:user-1$/);

    incrementOperationalCounter("http_5xx_total", 3);
    await expect
      .poll(() => admin.get(`${PREFIX}operations:counters:http_5xx_total`))
      .toBe("3");
    resetOperationalCountersForTests();
    expect((await readOperationalCounters()).http_5xx_total).toBe(3);
  });

  it("shares connection admission between replicas through Lua scripts", async () => {
    const logger = { error: () => {} };
    const replica = () =>
      new SharedConnectionAdmission({
        scope: "acl-test",
        limits: { global: 10, perCanvas: 1, perPrincipal: 10, perClient: 10 },
        upgradesPerMinute: 1,
        leaseMs: 60_000,
        redis: app(),
        logger,
      });
    const [one, two] = [replica(), replica()];
    const connection = (id: string) => ({
      id,
      canvasId: "canvas-1",
      principalId: `user-${id}`,
      clientId: `client-${id}`,
    });

    expect(await one.admit(connection("a"))).toEqual({ admitted: true });
    // Only the shared sorted set knows replica one holds the canvas.
    expect(await two.admit(connection("b"))).toEqual({
      admitted: false,
      reason: "canvas",
    });
    await one.renew([connection("a")]);
    await one.release(connection("a"));
    expect(await two.admit(connection("b"))).toEqual({ admitted: true });

    expect(await one.consumeUpgrade("client-x")).toBe(true);
    // Replica two's local budget is fresh; only Redis refuses the second.
    expect(await two.consumeUpgrade("client-x")).toBe(false);
    for (const key of await allKeys())
      expect(key).toMatch(/^memoria:collaboration:admission:acl-test:/);
  });

  it("fans committed events and sync announcements out on prefixed channels", async () => {
    const subscriber = app().duplicate();
    subscribers.push(subscriber);
    const canvasId = "clcanvas123456789012345678";
    expect(canvasChannel(canvasId)).toBe(
      `${PREFIX}collaboration:canvas:${canvasId}`,
    );
    expect(syncDocumentsChannel()).toBe(
      `${PREFIX}collaboration:sync:documents`,
    );
    await subscriber.subscribe(canvasChannel(canvasId), syncDocumentsChannel());

    const event = {
      id: "clevent12345678901234567890",
      sequence: 42n,
      canvasId,
      actorId: "user-1",
      entityId: "clitem12345678901234567890",
      entityVersion: 3,
      operation: "deleted",
      permissionScope: "VIEW",
      schemaVersion: 1,
      createdAt: new Date("2026-07-28T20:00:00.000Z"),
    };
    const prisma = {
      canvasEvent: { findUnique: async () => event },
    } as never;
    const committed = nextMessage(subscriber, canvasChannel(canvasId));
    // The outbox handler's own publisher, not an injected one.
    await createCanvasEventHandler(prisma)({
      id: "cljob123456789012345678901",
      payload: { eventId: event.id },
    } as never);
    expect(JSON.parse(await committed)).toMatchObject({
      type: "event",
      canvasId,
      payload: { eventId: event.id, cursor: "42" },
    });

    const announced = nextMessage(subscriber, syncDocumentsChannel());
    await app().publish(
      syncDocumentsChannel(),
      JSON.stringify({ canvasId, instanceId: "replica-a" }),
    );
    expect(JSON.parse(await announced)).toEqual({
      canvasId,
      instanceId: "replica-a",
    });
  });

  it("is refused anything outside the prefix, so the checks above are real", async () => {
    const unprefixed = new Redis(appUrl, { maxRetriesPerRequest: 0 });
    try {
      await expect(unprefixed.set("ratelimit:x", "1")).rejects.toThrow(
        /NOPERM/,
      );
      await expect(
        unprefixed.publish("collaboration:sync:documents", "{}"),
      ).rejects.toThrow(/NOPERM/);
      await expect(unprefixed.keys(`${PREFIX}*`)).rejects.toThrow(/NOPERM/);
      expect(
        await unprefixed.publish(redisChannel("collaboration:probe"), "{}"),
      ).toBe(0);
    } finally {
      await unprefixed.quit();
    }
    expect((await aclDenials()).length).toBeGreaterThan(0);
    await admin.call("ACL", "LOG", "RESET");
  });
});
