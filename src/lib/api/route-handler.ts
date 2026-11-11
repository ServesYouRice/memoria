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

function buildReplayResponse(
  status: number,
  body: unknown,
  idempotencyHit: boolean,
): NextResponse | Response {
  const headers: Record<string, string> = {};
  if (idempotencyHit) {
    headers["X-Idempotency-Hit"] = "true";
  }

  if (status === 204 || body === null || body === undefined) {
    return new NextResponse(null, { status, headers });
  }

  if (typeof body === "string") {
    headers["Content-Type"] = "text/plain; charset=utf-8";
    return new NextResponse(body, { status, headers });
  }

  return NextResponse.json(body, { status, headers });
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
  const IN_FLIGHT_LEASE_MS = 60 * 1000;

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

    // An expired lease with no journaled response is not proof the mutation
    // failed: it may have committed before the journal update was lost.
    // Running the handler again could repeat it, so the key is refused until
    // its TTL frees it (Q-001).
    const isLeaseExpired =
      Date.now() - existing.createdAt.getTime() > IN_FLIGHT_LEASE_MS;
    if (isLeaseExpired) {
      throw new ConflictError(
        "The earlier request with this idempotency key did not finish recording its result, so its outcome is unknown. Check the current state or retry with a new idempotency key.",
      );
    }
    throw new ConflictError("Request is currently being processed");
  }

  try {
    await prisma.idempotencyKey.create({
      data: { ...scope, requestHash },
    });
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
      return buildReplayResponse(
        raced.responseCode,
        raced.responseBody,
        true,
      );
    }

    throw new ConflictError("Idempotency key conflict");
  }

  try {
    const response = await handler();
    const body = await readResponseBody(response);

    await prisma.idempotencyKey
      .update({
        where: { key_userId_method_path: scope },
        data: {
          responseCode: response.status,
          responseBody: body as Prisma.InputJsonValue,
        },
      })
      .catch((error) =>
        logger.error(
          { error, key, userId },
          "Mutation succeeded but idempotency response journaling failed",
        ),
      );

    return response;
  } catch (error) {
    const failureResponse = errorResponse(error, req.url);
    const body = await readResponseBody(failureResponse);

    await prisma.idempotencyKey
      .update({
        where: { key_userId_method_path: scope },
        data: {
          responseCode: failureResponse.status,
          responseBody: body as Prisma.InputJsonValue,
        },
      })
      .catch(() => {});

    return failureResponse;
  }
}
