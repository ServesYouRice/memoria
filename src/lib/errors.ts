/**
 * Consolidated RFC 7807 Error Handling
 * Following ADR-0001: API Versioning & Error Contract
 *
 * This is the canonical error handling module combining:
 * - Class-based errors with proper inheritance
 * - NextResponse integration for API routes
 * - Zod error conversion
 * - Convenience factory functions
 * - RFC 7807 Problem Details standard
 */

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

/**
 * RFC 7807 Problem Details interface
 */
export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  [key: string]: unknown;
}

/**
 * Validation error structure
 */
export interface ValidationErrorDetail {
  field: string;
  message: string;
  code?: string;
}

/**
 * Base API Error class
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public type: string,
    public title: string,
    public detail?: string,
    public extensions?: Record<string, unknown>
  ) {
    super(title);
    this.name = 'ApiError';
  }

  toProblemDetail(instance?: string): ProblemDetail {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      detail: this.detail,
      instance,
      ...this.extensions,
    };
  }
}

/**
 * Common API error classes
 */
export class BadRequestError extends ApiError {
  constructor(detail?: string) {
    super(400, 'https://canvascollect.com/errors/bad-request', 'Bad Request', detail);
  }
}

export class ValidationError extends ApiError {
  constructor(
    detail: string,
    public errors?: ValidationErrorDetail[]
  ) {
    super(400, 'https://canvascollect.com/errors/validation', 'Validation Error', detail, {
      errors,
    });
  }
}

export class UnauthorizedError extends ApiError {
  constructor(detail = 'Authentication required') {
    super(401, 'https://canvascollect.com/errors/unauthorized', 'Unauthorized', detail);
  }
}

export class ForbiddenError extends ApiError {
  constructor(detail = 'You do not have permission to access this resource') {
    super(403, 'https://canvascollect.com/errors/forbidden', 'Forbidden', detail);
  }
}

export class NotFoundError extends ApiError {
  constructor(detail = 'Resource not found') {
    super(404, 'https://canvascollect.com/errors/not-found', 'Not Found', detail);
  }
}

export class ConflictError extends ApiError {
  constructor(detail: string, extensions?: Record<string, unknown>) {
    super(409, 'https://canvascollect.com/errors/conflict', 'Conflict', detail, extensions);
  }
}

export class VersionMismatchError extends ConflictError {
  constructor(expectedVersion: number, actualVersion: number) {
    super('Version mismatch - resource was modified by another request', {
      expectedVersion,
      actualVersion,
    });
  }
}

export class UnprocessableEntityError extends ApiError {
  constructor(detail?: string) {
    super(
      422,
      'https://canvascollect.com/errors/unprocessable-entity',
      'Unprocessable Entity',
      detail
    );
  }
}

export class TooManyRequestsError extends ApiError {
  constructor(detail = 'Rate limit exceeded', retryAfter?: number) {
    super(429, 'https://canvascollect.com/errors/too-many-requests', 'Too Many Requests', detail, {
      retryAfter,
    });
  }
}

export class InternalServerError extends ApiError {
  constructor(detail = 'An unexpected error occurred') {
    super(
      500,
      'https://canvascollect.com/errors/internal-server-error',
      'Internal Server Error',
      detail
    );
  }
}

/**
 * Convert Zod errors to ValidationError
 */
export function fromZodError(error: ZodError): ValidationError {
  const errors: ValidationErrorDetail[] = error.errors.map((err) => ({
    field: err.path.join('.'),
    message: err.message,
    code: err.code,
  }));

  return new ValidationError('Request validation failed', errors);
}

/**
 * Convenience factory functions for common errors
 * (for backward compatibility and convenience)
 */
export function badRequestError(detail?: string): BadRequestError {
  return new BadRequestError(detail);
}

export function notFoundError(resource: string, id?: string): NotFoundError {
  const detail = id ? `${resource} with id ${id} was not found.` : resource;
  return new NotFoundError(detail);
}

export function unauthorizedError(detail?: string): UnauthorizedError {
  return new UnauthorizedError(detail);
}

export function forbiddenError(detail?: string): ForbiddenError {
  return new ForbiddenError(detail);
}

export function conflictError(detail: string): ConflictError {
  return new ConflictError(detail);
}

export function validationError(errors: Record<string, string[]>): ValidationError {
  const errorDetails: ValidationErrorDetail[] = [];
  for (const [field, messages] of Object.entries(errors)) {
    for (const message of messages) {
      errorDetails.push({ field, message });
    }
  }
  return new ValidationError('One or more validation errors occurred.', errorDetails);
}

export function versionMismatchError(expectedVersion: number, actualVersion: number): VersionMismatchError {
  return new VersionMismatchError(expectedVersion, actualVersion);
}

/**
 * Problem factory functions (for factory pattern users)
 */
export function createProblem(
  status: number,
  title: string,
  detail?: string,
  type?: string,
  additional?: Record<string, unknown>
): ProblemDetail {
  return {
    type: type || `https://canvascollect.com/errors/${status}`,
    title,
    status,
    detail,
    ...additional,
  };
}

export function createValidationProblem(
  errors: ValidationErrorDetail[],
  detail = 'One or more validation errors occurred'
): ProblemDetail {
  return {
    type: 'https://canvascollect.com/errors/validation',
    title: 'Validation Error',
    status: 400,
    detail,
    errors,
  };
}

/**
 * Problems object for convenient factory creation
 */
export const Problems = {
  BadRequest: (detail?: string) =>
    createProblem(400, 'Bad Request', detail || 'Invalid request'),

  Unauthorized: (detail?: string) =>
    createProblem(
      401,
      'Unauthorized',
      detail || 'Authentication required',
      'https://canvascollect.com/errors/unauthorized'
    ),

  Forbidden: (detail?: string) =>
    createProblem(
      403,
      'Forbidden',
      detail || 'You do not have permission to access this resource',
      'https://canvascollect.com/errors/forbidden'
    ),

  NotFound: (detail?: string) =>
    createProblem(
      404,
      'Not Found',
      detail || 'Resource not found',
      'https://canvascollect.com/errors/not-found'
    ),

  Conflict: (detail?: string) =>
    createProblem(409, 'Conflict', detail, 'https://canvascollect.com/errors/conflict'),

  UnprocessableEntity: (detail?: string) =>
    createProblem(
      422,
      'Unprocessable Entity',
      detail,
      'https://canvascollect.com/errors/unprocessable-entity'
    ),

  TooManyRequests: (detail?: string, retryAfter?: number) =>
    createProblem(
      429,
      'Too Many Requests',
      detail || 'Rate limit exceeded',
      'https://canvascollect.com/errors/too-many-requests',
      { retryAfter }
    ),

  InternalServerError: (detail?: string) =>
    createProblem(
      500,
      'Internal Server Error',
      detail || 'An unexpected error occurred',
      'https://canvascollect.com/errors/internal-server-error'
    ),

  ServiceUnavailable: (detail?: string) =>
    createProblem(
      503,
      'Service Unavailable',
      detail,
      'https://canvascollect.com/errors/service-unavailable'
    ),
} as const;

/**
 * NextResponse error handler (for Next.js API routes)
 */
export function errorResponse(error: unknown, instance?: string): NextResponse<ProblemDetail> {
  console.error('API Error:', error);

  if (error instanceof ApiError) {
    const problemDetail = error.toProblemDetail(instance);
    return NextResponse.json(problemDetail, {
      status: error.status,
      headers: {
        'Content-Type': 'application/problem+json',
      },
    });
  }

  if (error instanceof ZodError) {
    const validationErr = fromZodError(error);
    const problemDetail = validationErr.toProblemDetail(instance);
    return NextResponse.json(problemDetail, {
      status: 400,
      headers: {
        'Content-Type': 'application/problem+json',
      },
    });
  }

  // Generic error handler - don't leak details in production
  const problemDetail: ProblemDetail = {
    type: 'https://canvascollect.com/errors/internal-server-error',
    title: 'Internal Server Error',
    status: 500,
    detail:
      process.env.NODE_ENV === 'development'
        ? (error as Error).message
        : 'An unexpected error occurred.',
    instance,
  };

  return NextResponse.json(problemDetail, {
    status: 500,
    headers: {
      'Content-Type': 'application/problem+json',
    },
  });
}

/**
 * Generic Response error handler (for middleware or non-Next.js contexts)
 */
export function problemToResponse(problem: ProblemDetail): Response {
  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: {
      'Content-Type': 'application/problem+json',
    },
  });
}

/**
 * Handle API errors (backward compatibility alias)
 */
export const handleApiError = errorResponse;
