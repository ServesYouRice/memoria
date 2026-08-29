import { getRedisClient } from "@/lib/cache/redis-client";
import { createLogger } from "@/lib/logger";
import { incrementOperationalCounter } from "@/lib/operations/runtime-metrics";
import { AiBudgetError, AiBudgetStoreError, AiDisabledError } from "./errors";

const logger = createLogger("ai-budget");
const DAY_SECONDS = 48 * 60 * 60;
const DEFAULT_TOKEN_LIMIT = 100_000;
const DEFAULT_COST_LIMIT_MICRO_USD = 100_000;
const DEFAULT_CONCURRENCY_LIMIT = 2;
const DEFAULT_INPUT_RATE_MICRO_USD_PER_MILLION = 150_000;
const DEFAULT_OUTPUT_RATE_MICRO_USD_PER_MILLION = 600_000;
const DEFAULT_MAX_PROMPT_BYTES = 64 * 1024;

interface BudgetLimits {
  tokenLimit: number;
  costLimitMicroUsd: number;
  concurrencyLimit: number;
  maxPromptBytes: number;
  inputRateMicroUsdPerMillion: number;
  outputRateMicroUsdPerMillion: number;
}

export interface AiUsageSnapshot {
  enabled: boolean;
  date: string;
  tokensUsed: number;
  tokenLimit: number;
  costMicroUsdUsed: number;
  costMicroUsdLimit: number;
  activeRequests: number;
  concurrencyLimit: number;
  requests: number;
  rejections: number;
}

interface Reservation {
  key: string;
  userId: string;
  tokens: number;
  costMicroUsd: number;
  limits: BudgetLimits;
  backend: "redis" | "memory";
}

interface MemoryUsage {
  tokens: number;
  cost: number;
  concurrency: number;
  requests: number;
  rejections: number;
}

const globalBudget = globalThis as typeof globalThis & {
  __memoriaAiBudget?: Map<string, MemoryUsage>;
};

function memoryStore(): Map<string, MemoryUsage> {
  if (!globalBudget.__memoriaAiBudget) {
    globalBudget.__memoriaAiBudget = new Map();
  }
  return globalBudget.__memoriaAiBudget;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function limits(): BudgetLimits {
  return {
    tokenLimit: positiveInteger(
      process.env.AI_DAILY_TOKEN_BUDGET,
      DEFAULT_TOKEN_LIMIT,
    ),
    costLimitMicroUsd: positiveInteger(
      process.env.AI_DAILY_COST_MICRO_USD,
      DEFAULT_COST_LIMIT_MICRO_USD,
    ),
    concurrencyLimit: positiveInteger(
      process.env.AI_MAX_CONCURRENT_PER_USER,
      DEFAULT_CONCURRENCY_LIMIT,
    ),
    maxPromptBytes: positiveInteger(
      process.env.AI_MAX_PROMPT_BYTES,
      DEFAULT_MAX_PROMPT_BYTES,
    ),
    inputRateMicroUsdPerMillion: positiveInteger(
      process.env.AI_INPUT_COST_MICRO_USD_PER_MILLION,
      DEFAULT_INPUT_RATE_MICRO_USD_PER_MILLION,
    ),
    outputRateMicroUsdPerMillion: positiveInteger(
      process.env.AI_OUTPUT_COST_MICRO_USD_PER_MILLION,
      DEFAULT_OUTPUT_RATE_MICRO_USD_PER_MILLION,
    ),
  };
}

export function isAiEnabled(): boolean {
  return process.env.AI_ENABLED !== "false";
}

export function estimateAiTokens(value: string): number {
  return Math.max(1, Math.ceil(Buffer.byteLength(value, "utf8") / 4));
}

function dateKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function secondsUntilTomorrow(now = new Date()): number {
  const tomorrow = new Date(now);
  tomorrow.setUTCHours(24, 0, 0, 0);
  return Math.max(1, Math.ceil((tomorrow.getTime() - now.getTime()) / 1_000));
}

function budgetKey(userId: string, now = new Date()): string {
  return `memoria:ai:budget:${dateKey(now)}:${userId}`;
}

function reservationCost(
  promptTokens: number,
  outputTokens: number,
  budgetLimits: BudgetLimits,
): number {
  return Math.max(
    1,
    Math.ceil(
      (promptTokens * budgetLimits.inputRateMicroUsdPerMillion +
        outputTokens * budgetLimits.outputRateMicroUsdPerMillion) /
        1_000_000,
    ),
  );
}

const RESERVE_SCRIPT = `
local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens') or '0')
local cost = tonumber(redis.call('HGET', KEYS[1], 'cost') or '0')
local active = tonumber(redis.call('HGET', KEYS[1], 'concurrency') or '0')
if active + 1 > tonumber(ARGV[3]) then
  redis.call('HINCRBY', KEYS[1], 'rejections', 1)
  redis.call('EXPIRE', KEYS[1], ARGV[6])
  return {3, tokens, cost, active}
end
if tokens + tonumber(ARGV[1]) > tonumber(ARGV[4]) then
  redis.call('HINCRBY', KEYS[1], 'rejections', 1)
  redis.call('EXPIRE', KEYS[1], ARGV[6])
  return {1, tokens, cost, active}
end
if cost + tonumber(ARGV[2]) > tonumber(ARGV[5]) then
  redis.call('HINCRBY', KEYS[1], 'rejections', 1)
  redis.call('EXPIRE', KEYS[1], ARGV[6])
  return {2, tokens, cost, active}
end
redis.call('HINCRBY', KEYS[1], 'tokens', ARGV[1])
redis.call('HINCRBY', KEYS[1], 'cost', ARGV[2])
redis.call('HINCRBY', KEYS[1], 'concurrency', 1)
redis.call('HINCRBY', KEYS[1], 'requests', 1)
redis.call('EXPIRE', KEYS[1], ARGV[6])
return {0, tokens + tonumber(ARGV[1]), cost + tonumber(ARGV[2]), active + 1}
`;

const RELEASE_SCRIPT = `
local active = tonumber(redis.call('HGET', KEYS[1], 'concurrency') or '0')
if active > 0 then redis.call('HINCRBY', KEYS[1], 'concurrency', -1) end
redis.call('EXPIRE', KEYS[1], ARGV[1])
return math.max(0, active - 1)
`;

function throwBudget(code: number, retryAfter: number): never {
  incrementOperationalCounter("ai_budget_rejections_total");
  if (code === 3) {
    throw new AiBudgetError(
      "AI_CONCURRENCY_BUDGET",
      "Too many AI requests are already running for this account.",
      1,
    );
  }
  if (code === 2) {
    throw new AiBudgetError(
      "AI_COST_BUDGET",
      "This account has reached its daily AI cost allowance.",
      retryAfter,
    );
  }
  throw new AiBudgetError(
    "AI_TOKEN_BUDGET",
    "This account has reached its daily AI token allowance.",
    retryAfter,
  );
}

async function reserve(
  userId: string,
  prompt: string,
  maxOutputTokens: number,
): Promise<Reservation> {
  if (!isAiEnabled()) throw new AiDisabledError();
  const budgetLimits = limits();
  const promptBytes = Buffer.byteLength(prompt, "utf8");
  if (promptBytes > budgetLimits.maxPromptBytes) {
    throw new AiBudgetError(
      "AI_TOKEN_BUDGET",
      `AI prompt exceeds the ${budgetLimits.maxPromptBytes}-byte request budget.`,
      0,
    );
  }
  const inputTokens = estimateAiTokens(prompt);
  const tokens = inputTokens + maxOutputTokens;
  const costMicroUsd = reservationCost(
    inputTokens,
    maxOutputTokens,
    budgetLimits,
  );
  const now = new Date();
  const key = budgetKey(userId, now);
  const retryAfter = secondsUntilTomorrow(now);
  const redis = getRedisClient();
  if (redis) {
    try {
      const result = (await redis.eval(
        RESERVE_SCRIPT,
        1,
        key,
        tokens,
        costMicroUsd,
        budgetLimits.concurrencyLimit,
        budgetLimits.tokenLimit,
        budgetLimits.costLimitMicroUsd,
        DAY_SECONDS,
      )) as number[];
      if (Number(result[0]) !== 0) throwBudget(Number(result[0]), retryAfter);
      incrementOperationalCounter("ai_requests_total");
      incrementOperationalCounter("ai_reserved_tokens_total", tokens);
      incrementOperationalCounter(
        "ai_reserved_cost_micro_usd_total",
        costMicroUsd,
      );
      return {
        key,
        userId,
        tokens,
        costMicroUsd,
        limits: budgetLimits,
        backend: "redis",
      };
    } catch (error) {
      if (error instanceof AiBudgetError) throw error;
      logger.error(
        { errorName: (error as Error)?.name },
        "AI budget reservation store failed",
      );
      incrementOperationalCounter("redis_safety_failures_total");
      if (process.env.NODE_ENV === "production") {
        throw new AiBudgetStoreError();
      }
    }
  }

  const store = memoryStore();
  const current = store.get(key) ?? {
    tokens: 0,
    cost: 0,
    concurrency: 0,
    requests: 0,
    rejections: 0,
  };
  let rejection = 0;
  if (current.concurrency + 1 > budgetLimits.concurrencyLimit) rejection = 3;
  else if (current.tokens + tokens > budgetLimits.tokenLimit) rejection = 1;
  else if (current.cost + costMicroUsd > budgetLimits.costLimitMicroUsd)
    rejection = 2;
  if (rejection) {
    current.rejections += 1;
    store.set(key, current);
    throwBudget(rejection, retryAfter);
  }
  current.tokens += tokens;
  current.cost += costMicroUsd;
  current.concurrency += 1;
  current.requests += 1;
  store.set(key, current);
  incrementOperationalCounter("ai_requests_total");
  incrementOperationalCounter("ai_reserved_tokens_total", tokens);
  incrementOperationalCounter("ai_reserved_cost_micro_usd_total", costMicroUsd);
  return {
    key,
    userId,
    tokens,
    costMicroUsd,
    limits: budgetLimits,
    backend: "memory",
  };
}

async function release(reservation: Reservation): Promise<void> {
  if (reservation.backend === "redis") {
    const redis = getRedisClient();
    if (!redis) return;
    await redis
      .eval(RELEASE_SCRIPT, 1, reservation.key, DAY_SECONDS)
      .catch((error) => {
        logger.error(
          { errorName: (error as Error)?.name },
          "AI concurrency release failed",
        );
        incrementOperationalCounter("redis_safety_failures_total");
      });
    return;
  }
  const current = memoryStore().get(reservation.key);
  if (current) current.concurrency = Math.max(0, current.concurrency - 1);
}

function snapshot(
  values: Partial<MemoryUsage>,
  budgetLimits = limits(),
): AiUsageSnapshot {
  return {
    enabled: isAiEnabled(),
    date: dateKey(),
    tokensUsed: Number(values.tokens || 0),
    tokenLimit: budgetLimits.tokenLimit,
    costMicroUsdUsed: Number(values.cost || 0),
    costMicroUsdLimit: budgetLimits.costLimitMicroUsd,
    activeRequests: Number(values.concurrency || 0),
    concurrencyLimit: budgetLimits.concurrencyLimit,
    requests: Number(values.requests || 0),
    rejections: Number(values.rejections || 0),
  };
}

export async function getAiUsage(userId: string): Promise<AiUsageSnapshot> {
  const key = budgetKey(userId);
  const redis = getRedisClient();
  if (redis) {
    try {
      const values = await redis.hgetall(key);
      return snapshot({
        tokens: Number(values.tokens || 0),
        cost: Number(values.cost || 0),
        concurrency: Number(values.concurrency || 0),
        requests: Number(values.requests || 0),
        rejections: Number(values.rejections || 0),
      });
    } catch (error) {
      logger.warn(
        { errorName: (error as Error)?.name },
        "AI usage store read failed",
      );
      if (process.env.NODE_ENV === "production") throw new AiBudgetStoreError();
    }
  }
  return snapshot(memoryStore().get(key) ?? {});
}

export async function runBudgetedAi<T>(
  userId: string,
  input: { prompt: string; maxOutputTokens: number },
  operation: () => Promise<T>,
): Promise<{ value: T; usage: AiUsageSnapshot }> {
  const reservation = await reserve(
    userId,
    input.prompt,
    input.maxOutputTokens,
  );
  let value: T;
  try {
    value = await operation();
  } finally {
    await release(reservation);
  }
  return { value, usage: await getAiUsage(userId) };
}

export function resetAiBudgetForTests(): void {
  globalBudget.__memoriaAiBudget = undefined;
}
