import { NextResponse } from "next/server";
import {
  createCachedReadiness,
  evaluateReadiness,
} from "@/lib/operations/readiness";
import { toPublicStatus } from "@/lib/operations/public-status";
import {
  getClientIdentifier,
  SlidingWindowRateLimiter,
} from "@/lib/rate-limit";
import { MemoryRateLimitStore } from "@/lib/rate-limit/stores/memory";

export const dynamic = "force-dynamic";

/** Dependency checks run at most once per this window per process. */
const STATUS_CACHE_TTL_MS = 5_000;
const STATUS_RATE_LIMIT = { maxRequests: 60, windowSeconds: 60 };

const readStatus = createCachedReadiness(
  () => evaluateReadiness(),
  STATUS_CACHE_TTL_MS,
);

// The limit guards this process's cached checks, so it lives in this process
// too: a Redis outage is exactly when the status page must still answer.
const statusLimiter = new SlidingWindowRateLimiter(new MemoryRateLimitStore(), {
  ...STATUS_RATE_LIMIT,
  keyPrefix: "status",
});

export async function GET(request: Request) {
  const limit = await statusLimiter.check(getClientIdentifier(request));
  if (!limit.allowed) {
    return NextResponse.json(
      {
        type: "https://memoria.local/errors/rate-limit-exceeded",
        title: "Too Many Requests",
        status: 429,
        detail: "Rate limit exceeded. Please try again later.",
      },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(limit.resetIn),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(limit.resetAt),
        },
      },
    );
  }

  const snapshot = await readStatus();
  return NextResponse.json(
    {
      status: toPublicStatus(snapshot.status),
      checkedAt: snapshot.checkedAt,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
