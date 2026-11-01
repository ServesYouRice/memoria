import { prisma } from "@/lib/db";
import { getRedisClient } from "@/lib/cache/redis-client";
import { checkPrivateUploadStorage } from "@/lib/uploads/private-storage";

export type ReadinessStatus = "ready" | "degraded" | "unavailable";
export type ReadinessEffect = "traffic" | "feature";

export interface ReadinessCheckDefinition {
  name: "database" | "migrations" | "redis" | "upload-storage";
  effect: ReadinessEffect;
  run: () => Promise<unknown>;
}

export interface ReadinessSnapshot {
  status: ReadinessStatus;
  checkedAt: string;
  checks: Array<{
    name: ReadinessCheckDefinition["name"];
    effect: ReadinessEffect;
    status: "ok" | "failed";
  }>;
}

export const READINESS_POLICY = {
  database: "traffic",
  migrations: "traffic",
  redis: "traffic",
  "upload-storage": "feature",
} as const satisfies Record<ReadinessCheckDefinition["name"], ReadinessEffect>;

function defaultChecks(): ReadinessCheckDefinition[] {
  return [
    {
      name: "database",
      effect: READINESS_POLICY.database,
      run: () => prisma.$queryRaw`SELECT 1`,
    },
    {
      name: "migrations",
      effect: READINESS_POLICY.migrations,
      run: async () => {
        const rows = await prisma.$queryRaw`
          SELECT 1 FROM "_prisma_migrations"
          WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL
          LIMIT 1
        `;
        if (Array.isArray(rows) && rows.length > 0) {
          throw new Error("migration incomplete");
        }
      },
    },
    {
      name: "redis",
      effect: READINESS_POLICY.redis,
      run: async () => {
        const redis = getRedisClient();
        if (!redis) throw new Error("redis unavailable");
        await redis.ping();
      },
    },
    {
      name: "upload-storage",
      effect: READINESS_POLICY["upload-storage"],
      run: checkPrivateUploadStorage,
    },
  ];
}

async function runWithDeadline(
  run: () => Promise<unknown>,
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(run),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("readiness check timed out")),
          timeoutMs,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function evaluateReadiness(
  checks: ReadinessCheckDefinition[] = defaultChecks(),
  timeoutMs = Number(process.env.READINESS_CHECK_TIMEOUT_MS || 3_000),
): Promise<ReadinessSnapshot> {
  const settled = await Promise.allSettled(
    checks.map((check) => runWithDeadline(check.run, timeoutMs)),
  );
  const results = checks.map((check, index) => ({
    name: check.name,
    effect: check.effect,
    status: settled[index]?.status === "fulfilled" ? "ok" : "failed",
  })) satisfies ReadinessSnapshot["checks"];
  const trafficFailed = results.some(
    (check) => check.effect === "traffic" && check.status === "failed",
  );
  const featureFailed = results.some(
    (check) => check.effect === "feature" && check.status === "failed",
  );

  return {
    status: trafficFailed
      ? "unavailable"
      : featureFailed
        ? "degraded"
        : "ready",
    checkedAt: new Date().toISOString(),
    checks: results,
  };
}

/**
 * Share one readiness evaluation across callers for `ttlMs`. Concurrent
 * callers while an evaluation runs wait for that same run, so a burst of
 * requests costs one set of dependency checks per window. A run that throws
 * is not cached.
 */
export function createCachedReadiness(
  evaluate: () => Promise<ReadinessSnapshot>,
  ttlMs: number,
  now: () => number = Date.now,
): () => Promise<ReadinessSnapshot> {
  let cached: { snapshot: ReadinessSnapshot; expiresAt: number } | null = null;
  let inflight: Promise<ReadinessSnapshot> | null = null;

  return () => {
    if (cached && cached.expiresAt > now()) {
      return Promise.resolve(cached.snapshot);
    }
    if (!inflight) {
      inflight = evaluate()
        .then((snapshot) => {
          cached = { snapshot, expiresAt: now() + ttlMs };
          return snapshot;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };
}
