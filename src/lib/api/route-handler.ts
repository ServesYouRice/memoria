import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { type ZodSchema } from "zod";
import { createLogger } from "@/lib/logger";
import {
  BadRequestError,
  UnauthorizedError,
  ConflictError,
  errorResponse,
  fromZodError,
} from "@/lib/errors";
import { getCachedSession, runWithSessionCache } from "@/lib/api/session-cache";
import { createHash } from "crypto";
import { getRequestId } from "@/lib/api/request-context";
import type { Prisma } from "@/generated/prisma/client";

const logger = createLogger("api");
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** An in-flight request holds its key this long past its last renewal. */
const IN_FLIGHT_LEASE_MS = 60 * 1000;
/** How often a running request renews its lease (lockedAt). */
const LEASE_RENEW_MS = 20 * 1000;

/** Standard error response shape */
interface ErrorResponse {
  error: string;
  details?: unknown;
}

/**
 * Route handler that returns NextResponse or Response. `C` is the context
 * the route declares (for example `{ params: Promise<{ canvasId: string }> }`),
 * so each handler keeps its own parameter types.
 */
type RouteHandler<T = unknown, C = unknown> = (
  req: NextRequest,
  context: C,
) => Promise<NextResponse<T | ErrorResponse> | Response>;

/** Session type from auth() */
interface AuthSession {
  user: { id: string; email?: string | null; name?: string | null };
}

/** Authenticated route handler with session */
type AuthenticatedRouteHandler<T = unknown, C = unknown> = (
  req: NextRequest,
  session: AuthSession,
  context: C,
) => Promise<NextResponse<T | ErrorResponse> | Response>;

/**
 * Wrapper for API route handlers to provide centralized error handling
 */
export function withApiHandler<T, C = unknown>(
  handler: RouteHandler<T, C>,
): RouteHandler<T, C> {
  return async (req: NextRequest, context: C) => {
    return runWithSessionCache(async () => {
      try {
        return await handler(req, context);
      } catch (error) {
        const requestId = req.headers.get("x-request-id") || getRequestId();
        logger.error({ error, requestId }, "API Error");
        return errorResponse(error, req.url);
      }
    });
  };
}

/**
 * Wrapper for API route handlers that require authentication
 */
export function withAuth<T, C = unknown>(
  handler: AuthenticatedRouteHandler<T, C>,
): RouteHandler<T, C> {
  return withApiHandler<T, C>(async (req: NextRequest, context: C) => {
    const session = await getCachedSession();

    if (!session || !session.user?.id) {
      throw new UnauthorizedError();
    }

    const authSession: AuthSession = {
      user: session.user as {
        id: string;
        email?: string | null;
        name?: string | null;
      },
    };
    return handler(req, authSession, context);
  });
}

/**
 * Wrapper for request validation
 */
export function withValidation<T, C = unknown>(
  schema: ZodSchema<T>,
  handler: (
    data: T,
    req: NextRequest,
    context?: C,
  ) => Promise<NextResponse | Response>,
): RouteHandler<unknown, C> {
  return async (req: NextRequest, context: C) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new BadRequestError("Invalid JSON");
      }
      throw error;
    }

    const validation = schema.safeParse(body);
    if (!validation.success) {
      throw fromZodError(validation.error);
    }

    return await handler(validation.data, req, context);
  };
}

/**
 * Wrapper for API route handlers that require BOTH authentication AND validation
 */
export function withAuthValidation<T, C = unknown>(
  schema: ZodSchema<T>,
  handler: (
    data: T,
    req: NextRequest,
    session: AuthSession,
    context?: C,
  ) => Promise<NextResponse | Response>,
): RouteHandler<unknown, C> {
  return withAuth<unknown, C>(async (req, session, context) => {
    let body: unknown;
    try {
      // Parse a clone: runIdempotent hashes the request body through
      // req.clone(), which throws once the original body has been read.
      body = await req.clone().json();
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new BadRequestError("Invalid JSON");
      }
      throw error;
    }

    const validation = schema.safeParse(body);
    if (!validation.success) {
      throw fromZodError(validation.error);
    }

    return runIdempotent(req, session.user.id, () =>
      handler(validation.data, req, session, context),
    );
  });
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return null;
  }

  const cloned = response.clone();
  const contentType = cloned.headers.get("content-type") || "";

  if (
    contentType.includes("application/json") ||
    contentType.includes("+json")
  ) {
    try {
      return await cloned.json();
    } catch {
      return null;
    }
  }

  try {
    return await cloned.text();
  } catch {
    return null;
  }
}

/** Responses saved against an idempotency key and replayed until its TTL. */
function isJournaledStatus(status: number): boolean {
  return status < 500 && status !== 429;
}

function buildReplayResponse(
  status: number,
  body: unknown,
  idempotencyHit: boolean,
): NextResponse | Response {
  const headers: Record<string, string> = {};
  if (idempotencyHit) {
    headers["X-Idempotency-Hit"] = "true";
  }
  const requestId = getRequestId();
  if (requestId) headers["x-request-id"] = requestId;

  if (status === 204 || body === null || body === undefined) {
    return new NextResponse(null, { status, headers });
  }

  if (typeof body === "string") {
    headers["Content-Type"] = "text/plain; charset=utf-8";
    return new NextResponse(body, { status, headers });
  }

  // Stored errors are problem documents (errorResponse); the rest is JSON.
  headers["Content-Type"] =
    status >= 400 ? "application/problem+json" : "application/json";
  return new NextResponse(JSON.stringify(body), { status, headers });
}

export async function runIdempotent<T>(
  req: NextRequest,
  userId: string,
  handler: () => Promise<NextResponse<T> | Response>,
): Promise<NextResponse<T> | Response> {
  const key = req.headers.get("x-idempotency-key");
  if (!key) return handler();

  const requestBytes = await req.clone().arrayBuffer();
  const requestHash = createHash("sha256")
    .update(new Uint8Array(requestBytes))
    .digest("hex");

  const scope = {
    key,
    userId,
    method: req.method,
    path: req.nextUrl.pathname,
  };

  const expiryCutoff = new Date(Date.now() - IDEMPOTENCY_TTL_MS);

  let existing = await prisma.idempotencyKey.findUnique({
    where: { key_userId_method_path: scope },
  });

  if (existing && existing.createdAt < expiryCutoff) {
    await prisma.idempotencyKey
      .delete({ where: { id: existing.id } })
      .catch(() => {});
    existing = null;
  }

  if (existing) {
    if (existing.requestHash && existing.requestHash !== requestHash) {
      throw new ConflictError(
        "Idempotency key was already used with a different request body",
      );
    }
    if (existing.responseCode !== null && existing.responseCode !== undefined) {
      return buildReplayResponse(
        existing.responseCode,
        existing.responseBody,
        true,
      );
    }

    // The lease runs from lockedAt, which the running request renews, so a
    // slow handler is never mistaken for an abandoned one. A lease nobody
    // has renewed for IN_FLIGHT_LEASE_MS with no journaled response is still
    // not proof the mutation failed: it may have committed before the
    // journal update was lost. Running the handler again could repeat it, so
    // the key is refused until its TTL frees it (Q-001).
    const lockedAt = existing.lockedAt ?? existing.createdAt;
    const isLeaseExpired = Date.now() - lockedAt.getTime() > IN_FLIGHT_LEASE_MS;
    if (isLeaseExpired) {
      throw new ConflictError(
        "The earlier request with this idempotency key did not finish recording its result, so its outcome is unknown. Check the current state or retry with a new idempotency key.",
      );
    }
    throw new ConflictError("Request is currently being processed");
  }

  let claimId: string;
  try {
    const claim = await prisma.idempotencyKey.create({
      data: { ...scope, requestHash, lockedAt: new Date() },
      select: { id: true },
    });
    claimId = claim.id;
  } catch {
    const raced = await prisma.idempotencyKey.findUnique({
      where: { key_userId_method_path: scope },
    });

    if (raced?.requestHash && raced.requestHash !== requestHash) {
      throw new ConflictError(
        "Idempotency key was already used with a different request body",
      );
    }

    if (raced?.responseCode !== null && raced?.responseCode !== undefined) {
      return buildReplayResponse(raced.responseCode, raced.responseBody, true);
    }

    throw new ConflictError("Idempotency key conflict");
  }

  // Renew the lease while this request runs so a slow handler is not
  // reported as abandoned.
  const heartbeat = setInterval(() => {
    void prisma.idempotencyKey
      .updateMany({
        where: { id: claimId, responseCode: null },
        data: { lockedAt: new Date() },
      })
      .catch((error) =>
        logger.warn({ error, key, userId }, "Idempotency lease renewal failed"),
      );
  }, LEASE_RENEW_MS);
  heartbeat.unref?.();

  // Transient failures (5xx, 429) say nothing about the request itself:
  // free the key so a retry runs again instead of replaying the failure.
  // Every write targets this request's own row id, so a row that replaced
  // it (after the TTL freed the key) is never released or overwritten.
  const settle = async (
    response: Response,
    onJournalError: (error: unknown) => void,
  ) => {
    if (!isJournaledStatus(response.status)) {
      await prisma.idempotencyKey
        .deleteMany({ where: { id: claimId, responseCode: null } })
        .catch((error) =>
          logger.error(
            { error, key, userId },
            "Could not release an idempotency key after a transient failure",
          ),
        );
      return;
    }
    const body = await readResponseBody(response);
    try {
      const result = await prisma.idempotencyKey.updateMany({
        where: { id: claimId },
        data: {
          responseCode: response.status,
          responseBody: body as Prisma.InputJsonValue,
        },
      });
      if (result.count === 0) {
        logger.warn(
          { key, userId },
          "Idempotency claim was superseded; response not journaled",
        );
      }
    } catch (error) {
      onJournalError(error);
    }
  };

  try {
    const response = await handler();
    await settle(response, (error) =>
      logger.error(
        { error, key, userId },
        "Mutation succeeded but idempotency response journaling failed",
      ),
    );
    return response;
  } catch (error) {
    const failureResponse = errorResponse(error, req.url);
    await settle(failureResponse, () => {});
    return failureResponse;
  } finally {
    clearInterval(heartbeat);
  }
}
