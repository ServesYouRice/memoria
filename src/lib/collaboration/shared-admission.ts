/**
 * IMP-043 — connection limits that hold across realtime replicas.
 *
 * Every realtime process keeps its own counters (the global cap protects the
 * process itself), and when Redis is configured the per-canvas, per-principal
 * and per-client limits and the upgrade budget are also checked in Redis, so
 * two replicas together admit no more than one would. Each admitted
 * connection is a member of a sorted set per limit, scored by the time its
 * lease runs out; the owning process renews leases on its heartbeat, so the
 * connections of a replica that crashed fall out after one lease.
 *
 * If Redis fails, the process-local counters still apply (per replica) and
 * the failure is logged; refusing every connection during a Redis blip would
 * turn a cache outage into a collaboration outage.
 *
 * @module lib/collaboration/shared-admission
 */

import type Redis from "ioredis";
import {
  ConnectionAdmissionCounters,
  FixedWindowAdmissionBudget,
} from "./transport-policy";

export interface SharedAdmissionLimits {
  global: number;
  perCanvas: number;
  perPrincipal: number;
  perClient: number;
}

export interface AdmittedConnection {
  /** Unique per connection (not per user). */
  id: string;
  canvasId: string;
  principalId: string;
  clientId: string;
}

export type SharedAdmissionResult =
  | { admitted: true }
  | {
      admitted: false;
      reason: "global" | "canvas" | "principal" | "client";
    };

interface AdmissionLogger {
  error(object: object, message: string): void;
}

const KEY_PREFIX = "collaboration:admission:";

// Remove expired members, check every limit, then add the connection to
// every set. Uses the Redis clock so replicas with skewed clocks agree.
const ADMIT_SCRIPT = `
local time = redis.call("TIME")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local lease = tonumber(ARGV[1])
local member = ARGV[2]
for i = 1, #KEYS do
  redis.call("ZREMRANGEBYSCORE", KEYS[i], "-inf", now)
end
for i = 1, #KEYS do
  if redis.call("ZSCORE", KEYS[i], member) == false
    and redis.call("ZCARD", KEYS[i]) >= tonumber(ARGV[2 + i]) then
    return i
  end
end
for i = 1, #KEYS do
  redis.call("ZADD", KEYS[i], now + lease, member)
  redis.call("PEXPIRE", KEYS[i], lease)
end
return 0
`;

// Extend the lease of every connection this process still holds, adding it
// back if it is missing: admitted while Redis failed, or expired during an
// outage. A released connection is never resurrected: renew is sent only for
// connections still held, and release removes the connection locally before
// sending its ZREM on the same client, so Redis runs them in send order. Sets
// may exceed a limit right after recovery; admissions are refused until the
// count falls.
const RENEW_SCRIPT = `
local time = redis.call("TIME")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local lease = tonumber(ARGV[1])
for i = 1, #KEYS do
  redis.call("ZADD", KEYS[i], now + lease, ARGV[1 + i])
  redis.call("PEXPIRE", KEYS[i], lease)
end
return 0
`;

const BUDGET_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 or redis.call("PTTL", KEYS[1]) < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return count
`;

const LIMIT_REASONS = ["canvas", "principal", "client"] as const;

function limitKeys(scope: string, connection: AdmittedConnection): string[] {
  return [
    `${KEY_PREFIX}${scope}:canvas:${connection.canvasId}`,
    `${KEY_PREFIX}${scope}:principal:${connection.principalId}`,
    `${KEY_PREFIX}${scope}:client:${connection.clientId}`,
  ];
}

export class SharedConnectionAdmission {
  private readonly local = new ConnectionAdmissionCounters();
  private readonly localCanvases = new Map<string, number>();
  private readonly localUpgrades: FixedWindowAdmissionBudget;

  constructor(
    private readonly options: {
      /** Separates the presence socket's limits from the sync server's. */
      scope: string;
      limits: SharedAdmissionLimits;
      upgradesPerMinute: number;
      leaseMs: number;
      redis: Redis | null;
      logger: AdmissionLogger;
    },
  ) {
    this.localUpgrades = new FixedWindowAdmissionBudget(
      options.upgradesPerMinute,
      60_000,
    );
  }

  get totalConnections(): number {
    return this.local.totalConnections;
  }

  /** Count one upgrade attempt against the client's per-minute budget. */
  async consumeUpgrade(clientId: string): Promise<boolean> {
    if (!this.localUpgrades.consume(clientId)) return false;
    const { redis, scope, upgradesPerMinute } = this.options;
    if (!redis) return true;
    try {
      const count = (await redis.eval(
        BUDGET_SCRIPT,
        1,
        `${KEY_PREFIX}${scope}:upgrades:${clientId}`,
        60_000,
      )) as number;
      return count <= upgradesPerMinute;
    } catch (error) {
      this.options.logger.error(
        { error },
        "Shared upgrade budget unavailable; using this process's budget",
      );
      return true;
    }
  }

  async admit(connection: AdmittedConnection): Promise<SharedAdmissionResult> {
    const { limits } = this.options;
    if ((this.localCanvases.get(connection.canvasId) ?? 0) >= limits.perCanvas)
      return { admitted: false, reason: "canvas" };
    const local = this.local.tryAdmit(
      connection.principalId,
      connection.clientId,
      limits,
    );
    if (!local.admitted) return local;
    this.localCanvases.set(
      connection.canvasId,
      (this.localCanvases.get(connection.canvasId) ?? 0) + 1,
    );

    const { redis, scope, leaseMs } = this.options;
    if (!redis) return { admitted: true };
    try {
      const refused = (await redis.eval(
        ADMIT_SCRIPT,
        3,
        ...limitKeys(scope, connection),
        leaseMs,
        connection.id,
        limits.perCanvas,
        limits.perPrincipal,
        limits.perClient,
      )) as number;
      if (refused === 0) return { admitted: true };
      this.releaseLocal(connection);
      return { admitted: false, reason: LIMIT_REASONS[refused - 1] };
    } catch (error) {
      this.options.logger.error(
        { error },
        "Shared connection limits unavailable; using this process's limits",
      );
      return { admitted: true };
    }
  }

  /** Renew the shared leases of connections this process still holds. */
  async renew(connections: Iterable<AdmittedConnection>): Promise<void> {
    const { redis, scope, leaseMs } = this.options;
    if (!redis) return;
    const pipeline = redis.pipeline();
    let count = 0;
    for (const connection of connections) {
      const keys = limitKeys(scope, connection);
      pipeline.eval(
        RENEW_SCRIPT,
        keys.length,
        ...keys,
        leaseMs,
        connection.id,
        connection.id,
        connection.id,
      );
      count += 1;
    }
    if (count === 0) return;
    try {
      await pipeline.exec();
    } catch (error) {
      this.options.logger.error({ error }, "Could not renew connection leases");
    }
  }

  async release(connection: AdmittedConnection): Promise<void> {
    this.releaseLocal(connection);
    const { redis, scope } = this.options;
    if (!redis) return;
    try {
      const pipeline = redis.pipeline();
      for (const key of limitKeys(scope, connection))
        pipeline.zrem(key, connection.id);
      await pipeline.exec();
    } catch (error) {
      // The lease expires on its own.
      this.options.logger.error({ error }, "Could not release a connection");
    }
  }

  sweep(now = Date.now()): void {
    this.localUpgrades.sweep(now);
  }

  private releaseLocal(connection: AdmittedConnection): void {
    this.local.release(connection.principalId, connection.clientId);
    const next = (this.localCanvases.get(connection.canvasId) ?? 0) - 1;
    if (next > 0) this.localCanvases.set(connection.canvasId, next);
    else this.localCanvases.delete(connection.canvasId);
  }
}
