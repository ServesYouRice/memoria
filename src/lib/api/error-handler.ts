/**
 * API Error Handling Utilities
 *
 * Provides standardized error handling for API routes
 * See CODE_AUDIT_REPORT.md Issue #11
 */

import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api-error-handler');

/**
 * Standard API route handler type
 */
export type ApiRouteHandler = (
  request: NextRequest,
  context?: any
) => Promise<NextResponse> | NextResponse;

/**
 * Error response following RFC 7807 (Problem Details)
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  errors?: Array<{ field: string; message: string }>;
}

export const Problems = {
  Validation: (errors: Array<{ field: string; message: string }>): ProblemDetails => ({
    type: 'https://canvascollect.com/errors/validation-error',
    title: 'Validation Error',
    status: 400,
    detail: 'Invalid request data',
    errors
  }),
  NotFound: (detail: string): ProblemDetails => ({
    type: 'https://canvascollect.com/errors/not-found',
    title: 'Not Found',
    status: 404,
    detail
  }),
  Unauthorized: (detail: string): ProblemDetails => ({
    type: 'https://canvascollect.com/errors/unauthorized',
    title: 'Unauthorized',
    status: 401,
    detail
  }),
  Forbidden: (detail: string): ProblemDetails => ({
    type: 'https://canvascollect.com/errors/forbidden',
    title: 'Forbidden',
    status: 403,
    detail
  }),
  Internal: (detail: string): ProblemDetails => ({
    type: 'https://canvascollect.com/errors/internal-error',
    title: 'Internal Server Error',
    status: 500,
    detail
  })
};

/**
 * Create a standardized error response
 */
/**
 * Create a standardized error response
 */
export function createErrorResponse(
  error: unknown,
  requestUrl: string,
  status: number = 500
): NextResponse {
  const problem: ProblemDetails = {
    type: 'https://canvascollect.com/errors/internal-error',
    title: 'Internal Server Error',
    status,
    detail: 'An unexpected error occurred',
    instance: requestUrl,
  };

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    problem.type = 'https://canvascollect.com/errors/validation-error';
    problem.title = 'Validation Error';
    problem.status = 400;
    problem.detail = 'Invalid request data';
    problem.errors = error.errors.map((err) => ({
      field: err.path.join('.'),
      message: err.message,
    }));
    return NextResponse.json(problem, { status: 400 });
  }

  // Handle Prisma errors
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    problem.type = 'https://canvascollect.com/errors/database-error';
    problem.title = 'Database Error';
    problem.status = 400;

    switch (error.code) {
      case 'P2002':
        problem.detail = 'A record with this value already exists';
        break;
      case 'P2025':
        problem.status = 404;
        problem.title = 'Not Found';
        problem.detail = 'The requested resource was not found';
        break;
      case 'P2003':
        problem.detail = 'Invalid reference to related record';
        break;
      default:
        problem.detail = 'A database error occurred';
    }

    return NextResponse.json(problem, { status: problem.status });
  }

  // Handle Prisma timeout errors
  if (error instanceof Prisma.PrismaClientInitializationError) {
    problem.type = 'https://canvascollect.com/errors/database-connection-error';
    problem.title = 'Database Connection Error';
    problem.status = 503;
    problem.detail = 'Unable to connect to the database';
    return NextResponse.json(problem, { status: 503 });
  }

  // Handle custom application errors
  if (error instanceof Error) {
    const errorName = error.constructor.name;

    switch (errorName) {
      case 'UnauthorizedError':
        problem.type = 'https://canvascollect.com/errors/unauthorized';
        problem.title = 'Unauthorized';
        problem.status = 401;
        problem.detail = error.message;
        return NextResponse.json(problem, { status: 401 });

      case 'ForbiddenError':
        problem.type = 'https://canvascollect.com/errors/forbidden';
        problem.title = 'Forbidden';
        problem.status = 403;
        problem.detail = error.message;
        return NextResponse.json(problem, { status: 403 });

      case 'NotFoundError':
        problem.type = 'https://canvascollect.com/errors/not-found';
        problem.title = 'Not Found';
        problem.status = 404;
        problem.detail = error.message;
        return NextResponse.json(problem, { status: 404 });

      case 'ValidationError':
        problem.type = 'https://canvascollect.com/errors/validation-error';
        problem.title = 'Validation Error';
        problem.status = 400;
        problem.detail = error.message;
        return NextResponse.json(problem, { status: 400 });

      case 'ConflictError':
        problem.type = 'https://canvascollect.com/errors/conflict';
        problem.title = 'Conflict';
        problem.status = 409;
        problem.detail = error.message;
        return NextResponse.json(problem, { status: 409 });

      default:
        problem.detail = error.message || 'An unexpected error occurred';
    }
  }

  return NextResponse.json(problem, { status: status });
}

/**
 * Wrapper for API route handlers with standardized error handling
 *
 * Usage:
 * ```typescript
 * export const GET = withErrorHandler(async (request) => {
 *   // Your route logic here
 *   // No try-catch needed!
 *   const data = await fetchData();
 *   return NextResponse.json(data);
 * });
 * ```
 *
 * FIXED: Issue #11 - Standardizes error handling across all API routes
 */
export function withErrorHandler(handler: ApiRouteHandler): ApiRouteHandler {
  return async (request: NextRequest, context?: any) => {
    try {
      return await handler(request, context);
    } catch (error) {
      // Log error
      logger.error(
        {
          error,
          url: request.url,
          method: request.method,
          errorType: error?.constructor?.name,
        },
        'API route error'
      );

      // Return standardized error response
      return createErrorResponse(error, request.url);
    }
  };
}

/**
 * Wrapper with request timeout
 *
 * FIXED: Issue #13 - Adds configurable timeout to API routes
 *
 * Usage:
 * ```typescript
 * export const GET = withTimeout(
 *   withErrorHandler(async (request) => {
 *     // Your route logic
 *   }),
 *   5000 // 5 second timeout
 * );
 * ```
 */
export function withTimeout(
  handler: ApiRouteHandler,
  timeoutMs: number = 10000
): ApiRouteHandler {
  return async (request: NextRequest, context?: any) => {
    const timeoutPromise = new Promise<NextResponse>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([handler(request, context), timeoutPromise]);
    } catch (error) {
      if (error instanceof Error && error.message.includes('timeout')) {
        logger.warn({ url: request.url, timeoutMs }, 'Request timeout');
        return NextResponse.json(
          {
            type: 'https://canvascollect.com/errors/timeout',
            title: 'Request Timeout',
            status: 504,
            detail: `Request took longer than ${timeoutMs}ms`,
            instance: request.url,
          },
          { status: 504 }
        );
      }
      throw error;
    }
  };
}

/**
 * Combined wrapper with error handling and timeout
 *
 * Usage:
 * ```typescript
 * export const GET = withApiHandler(async (request) => {
 *   const data = await fetchData();
 *   return NextResponse.json(data);
 * });
 * ```
 */
export function withApiHandler(
  handler: ApiRouteHandler,
  options: { timeout?: number } = {}
): ApiRouteHandler {
  const { timeout = 10000 } = options;
  return withErrorHandler(withTimeout(handler, timeout));
}

export { createErrorResponse as errorResponse };
