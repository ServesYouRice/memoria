/**
 * POST /api/v1/extensions/clip/batch
 *
 * Save up to 100 links (plus an optional sorting note) to the Inbox board in
 * one transaction. Authenticated with an API key in `x-api-key`; the body's
 * `idempotencyKey` makes a retried batch a replay (200) instead of a second
 * set of items (201). Used by the browser extension (IMP-061).
 */

import { type NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/route-handler";
import {
  authenticateApiKey,
  checkApiKeyRateLimit,
  getApiKeyRateLimitHeaders,
} from "@/lib/api/api-key-auth";
import { createRateLimiter } from "@/lib/rate-limit";
import {
  BadRequestError,
  Problems,
  fromZodError,
  unauthorizedError,
} from "@/lib/errors";
import { clipBatchSchema } from "@/lib/validation/extension";
import { ClipBatchSource, saveClipBatch } from "@/lib/services/clip-batch";

// A batch writes up to 100 items, so it gets a much smaller budget than the
// general per-key API limit it also counts against.
const clipBatchLimiter = createRateLimiter({
  maxRequests: 20,
  windowSeconds: 60,
  keyPrefix: "clip-batch",
});

export const POST = withApiHandler(async (req: NextRequest) => {
  const authResult = await authenticateApiKey(req);
  if (!authResult) {
    throw unauthorizedError("Invalid API Key");
  }

  for (const rateLimit of [
    await checkApiKeyRateLimit(authResult.apiKeyId),
    await clipBatchLimiter.check(authResult.apiKeyId),
  ]) {
    if (!rateLimit.allowed) {
      return NextResponse.json(
        Problems.TooManyRequests("Rate limit exceeded", rateLimit.resetIn),
        { status: 429, headers: getApiKeyRateLimitHeaders(rateLimit) },
      );
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new BadRequestError("Invalid JSON");
  }
  const validation = clipBatchSchema.safeParse(body);
  if (!validation.success) {
    throw fromZodError(validation.error);
  }

  const result = await saveClipBatch({
    userId: authResult.user.id,
    source: ClipBatchSource.EXTENSION,
    data: validation.data,
  });

  return NextResponse.json(result, {
    status: result.replayed ? 200 : 201,
    headers: result.replayed ? { "X-Idempotency-Hit": "true" } : undefined,
  });
});
