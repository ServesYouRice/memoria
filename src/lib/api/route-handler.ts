/**
 * API Route Handler Wrapper
 *
 * Higher-order function to reduce try/catch duplication in API routes.
 * Provides consistent error handling, logging, and response formatting.
 *
 * @module lib/api/route-handler
 *
 * @example
 * ```typescript
 * // Instead of manually handling errors in each route:
 * export const GET = withApiHandler(async (req) => {
 *   const data = await fetchData();
 *   return NextResponse.json(data);
 * });
 * ```
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { type ProblemDetails, Problems } from './error-handler';

type ApiHandler<T = unknown> = (req: NextRequest) => Promise<NextResponse<T>>;

/**
 * Wrap an API route handler with consistent error handling
 */
export function withApiHandler<T>(handler: ApiHandler<T>): ApiHandler<T | ProblemDetails> {
    return async (req: NextRequest) => {
        const startTime = Date.now();
        const requestId = crypto.randomUUID();

        try {
            const response = await handler(req);

            // Log successful requests
            logger.info({
                requestId,
                method: req.method,
                url: req.url,
                status: response.status,
                duration: Date.now() - startTime,
            }, 'API request completed');

            return response;
        } catch (error) {
            // Handle Zod validation errors
            if (error instanceof z.ZodError) {
                const problem = Problems.Validation(
                    error.errors.map((e) => ({
                        field: e.path.join('.'),
                        message: e.message,
                    }))
                );

                logger.warn({
                    requestId,
                    method: req.method,
                    url: req.url,
                    errors: error.errors,
                    duration: Date.now() - startTime,
                }, 'Validation error');

                return NextResponse.json(problem, { status: 400 });
            }

            // Handle known application errors
            if (error instanceof Error) {
                // Check for specific error types
                if (error.message.includes('not found')) {
                    const problem = Problems.NotFound(error.message);
                    return NextResponse.json(problem, { status: 404 });
                }

                if (error.message.includes('unauthorized') || error.message.includes('Unauthorized')) {
                    const problem = Problems.Unauthorized(error.message);
                    return NextResponse.json(problem, { status: 401 });
                }

                if (error.message.includes('forbidden') || error.message.includes('Forbidden')) {
                    const problem = Problems.Forbidden(error.message);
                    return NextResponse.json(problem, { status: 403 });
                }
            }

            // Log and return internal server error
            logger.error({
                requestId,
                method: req.method,
                url: req.url,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                duration: Date.now() - startTime,
            }, 'API request failed');

            const problem = Problems.Internal('An unexpected error occurred');
            return NextResponse.json(problem, { status: 500 });
        }
    };
}

/**
 * Wrap an API route handler with request body validation
 */
export function withValidation<T extends z.ZodType>(schema: T) {
    return function <R>(handler: (data: z.infer<T>, req: NextRequest) => Promise<NextResponse<R>>) {
        return withApiHandler(async (req: NextRequest) => {
            const body = await req.json();
            const data = schema.parse(body);
            return handler(data, req);
        });
    };
}

/**
 * Wrap an API route handler with authentication check
 */
export function withAuth<T>(handler: ApiHandler<T>): ApiHandler<T | ProblemDetails> {
    return withApiHandler(async (req: NextRequest) => {
        // Import auth dynamically to avoid circular dependencies
        const { auth } = await import('@/lib/auth');
        const session = await auth();

        if (!session?.user) {
            throw new Error('Unauthorized');
        }

        // Attach user to request for downstream handlers
        (req as any).user = session.user;

        return handler(req);
    });
}
