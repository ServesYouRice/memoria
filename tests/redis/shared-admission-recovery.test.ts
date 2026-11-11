/**
 * TASK-169: connections admitted while Redis failed, or whose shared
 * membership expired during an outage, rejoin the shared sets on the next
 * renewal; a released connection is not added back.
 *
 * Runs against a real Redis: SHARED_ADMISSION_REDIS_URL, or the ACL user of
 * `pnpm test:redis` (REDIS_ACL_TEST_URL). Keys use the `memoria:` prefix the
 * shared cluster's ACL allows.
 */
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SharedConnectionAdmission } from "@/lib/collaboration/shared-admission";

const url =
  process.env.SHARED_ADMISSION_REDIS_URL ?? process.env.REDIS_ACL_TEST_URL;
const scope = `recovery-${process.pid}-${Date.now()}`;
const keys = (canvasId: string, principalId: string, clientId: string) => [
  `collaboration:admission:${scope}:canvas:${canvasId}`,
  `collaboration:admission:${scope}:principal:${principalId}`,
  `collaboration:admission:${scope}:client:${clientId}`,
];

let redis: Redis;

beforeAll(() => {
  if (url) redis = new Redis(url, { keyPrefix: "memoria:" });
});

afterAll(async () => {
  if (!redis) return;
  const stale = await redis.keys(`memoria:collaboration:admission:${scope}:*`);
  for (const key of stale) await redis.del(key.slice("memoria:".length));
  redis.disconnect();
});

/** The real client, with eval failing while `down.value` is true. */
function flaky(down: { value: boolean }): Redis {
  return new Proxy(redis, {
    get(target, property, receiver) {
      if (property === "eval" && down.value)
        return () => Promise.reject(new Error("Redis is down"));
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function admission(client: Redis) {
  return new SharedConnectionAdmission({
    scope,
    limits: { global: 100, perCanvas: 10, perPrincipal: 10, perClient: 10 },
    upgradesPerMinute: 10,
    leaseMs: 60_000,
    redis: client,
    logger: { error: vi.fn() },
  });
}

describe.skipIf(!url)("shared admission recovery", () => {
  it("adds connections admitted during an outage on the next renewal", async () => {
    const down = { value: true };
    const shared = admission(flaky(down));
    const held = {
      id: "held-1",
      canvasId: "c-out",
      principalId: "p-out",
      clientId: "ip-out",
    };
    expect(await shared.admit(held)).toEqual({ admitted: true });
    for (const key of keys("c-out", "p-out", "ip-out"))
      expect(await redis.zscore(key, held.id)).toBeNull();

    down.value = false;
    await shared.renew([held]);
    for (const key of keys("c-out", "p-out", "ip-out"))
      expect(await redis.zscore(key, held.id)).not.toBeNull();
  });

  it("re-adds a membership that expired during an outage", async () => {
    const shared = admission(redis);
    const held = {
      id: "held-2",
      canvasId: "c-exp",
      principalId: "p-exp",
      clientId: "ip-exp",
    };
    expect(await shared.admit(held)).toEqual({ admitted: true });
    // The lease ran out while Redis was unreachable.
    for (const key of keys("c-exp", "p-exp", "ip-exp")) await redis.del(key);

    await shared.renew([held]);
    for (const key of keys("c-exp", "p-exp", "ip-exp"))
      expect(await redis.zscore(key, held.id)).not.toBeNull();
  });

  it("does not add back a released connection", async () => {
    const shared = admission(redis);
    const gone = {
      id: "gone-1",
      canvasId: "c-rel",
      principalId: "p-rel",
      clientId: "ip-rel",
    };
    expect(await shared.admit(gone)).toEqual({ admitted: true });
    await shared.release(gone);
    // The heartbeat renews only connections still held.
    await shared.renew([]);
    for (const key of keys("c-rel", "p-rel", "ip-rel"))
      expect(await redis.zscore(key, gone.id)).toBeNull();
  });

  it("removes a connection released while its renewal is in flight", async () => {
    const shared = admission(redis);
    const gone = {
      id: "gone-2",
      canvasId: "c-race",
      principalId: "p-race",
      clientId: "ip-race",
    };
    expect(await shared.admit(gone)).toEqual({ admitted: true });
    // Same client: Redis runs the renewal, then the release's ZREM.
    await Promise.all([shared.renew([gone]), shared.release(gone)]);
    for (const key of keys("c-race", "p-race", "ip-race"))
      expect(await redis.zscore(key, gone.id)).toBeNull();
  });
});
