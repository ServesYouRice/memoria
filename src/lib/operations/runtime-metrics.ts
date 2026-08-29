import { getRedisClient } from "@/lib/cache/redis-client";

export const OPERATIONAL_COUNTERS = [
  "http_4xx_total",
  "http_5xx_total",
  "redis_safety_failures_total",
  "websocket_rejected_total",
  "outbox_poll_failures_total",
  "outbox_handler_timeouts_total",
  "outbox_lease_lost_total",
  "email_delivery_failures_total",
  "backup_freshness_failures_total",
  "ai_requests_total",
  "ai_budget_rejections_total",
  "ai_reserved_tokens_total",
  "ai_reserved_cost_micro_usd_total",
  "account_exports_completed_total",
  "account_exports_failed_total",
  "account_exports_cancelled_total",
  "account_export_bytes_total",
] as const;

export type OperationalCounter = (typeof OPERATIONAL_COUNTERS)[number];

export const OPERATIONAL_GAUGES = [
  "websocket_connections",
  "websocket_active_canvases",
] as const;

export type OperationalGauge = (typeof OPERATIONAL_GAUGES)[number];

const COUNTER_PREFIX = "memoria:operations:counters:";
export const BACKUP_SUCCESS_GAUGE_KEY =
  "memoria:operations:gauges:backup_last_success_timestamp_seconds";

type CounterState = Record<OperationalCounter, number>;
type GaugeState = Record<OperationalGauge, number>;

const globalMetrics = globalThis as typeof globalThis & {
  __memoriaOperationalCounters?: CounterState;
  __memoriaOperationalGauges?: GaugeState;
};

function inMemoryCounters(): CounterState {
  if (!globalMetrics.__memoriaOperationalCounters) {
    globalMetrics.__memoriaOperationalCounters = Object.fromEntries(
      OPERATIONAL_COUNTERS.map((name) => [name, 0]),
    ) as CounterState;
  }
  return globalMetrics.__memoriaOperationalCounters;
}

function inMemoryGauges(): GaugeState {
  if (!globalMetrics.__memoriaOperationalGauges) {
    globalMetrics.__memoriaOperationalGauges = Object.fromEntries(
      OPERATIONAL_GAUGES.map((name) => [name, 0]),
    ) as GaugeState;
  }
  return globalMetrics.__memoriaOperationalGauges;
}

export function incrementOperationalCounter(
  name: OperationalCounter,
  amount = 1,
): void {
  const counters = inMemoryCounters();
  counters[name] += amount;
  const redis = getRedisClient();
  if (redis) {
    try {
      void redis.incrby(`${COUNTER_PREFIX}${name}`, amount).catch(() => {
        // The in-process counter remains available when shared metrics are down.
      });
    } catch {
      // Telemetry must never replace the operational failure being measured.
    }
  }
}

export function recordHttpStatus(status: number): void {
  if (status >= 500) incrementOperationalCounter("http_5xx_total");
  else if (status >= 400) incrementOperationalCounter("http_4xx_total");
}

export function setOperationalGauge(
  name: OperationalGauge,
  value: number,
): void {
  inMemoryGauges()[name] = Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function readOperationalGauges(): GaugeState {
  return { ...inMemoryGauges() };
}

export async function readOperationalCounters(): Promise<CounterState> {
  const local = inMemoryCounters();
  const redis = getRedisClient();
  if (!redis) return { ...local };
  try {
    const shared = await redis.mget(
      ...OPERATIONAL_COUNTERS.map((name) => `${COUNTER_PREFIX}${name}`),
    );
    return Object.fromEntries(
      OPERATIONAL_COUNTERS.map((name, index) => [
        name,
        Number(shared[index] || local[name]),
      ]),
    ) as CounterState;
  } catch {
    return { ...local };
  }
}

export async function readBackupSuccessTimestamp(): Promise<number> {
  const redis = getRedisClient();
  if (!redis) return 0;
  try {
    return Number((await redis.get(BACKUP_SUCCESS_GAUGE_KEY)) || 0);
  } catch {
    return 0;
  }
}

export function resetOperationalCountersForTests(): void {
  globalMetrics.__memoriaOperationalCounters = undefined;
  globalMetrics.__memoriaOperationalGauges = undefined;
}
