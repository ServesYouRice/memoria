import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { ZodSchema } from 'zod';
import { auth } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { ApiError } from '@/lib/errors'; // Assuming this exists or using simple Error

const logger = createLogger('api');

type RouteHandler<T = any> = (
    req: NextRequest,
    context?: any
) => Promise<NextResponse<T> | Response>;

type AuthenticatedRouteHandler<T = any> = (
    req: NextRequest,
    session: any, // Typed as Session from next-auth
    context?: any
) => Promise<NextResponse<T> | Response>;

/**
 * Wrapper for API route handlers to provide centralized error handling
 */
export function withApiHandler<T>(handler: RouteHandler<T>): RouteHandler<T> {
    return async (req: NextRequest, context?: any) => {
        try {
            return await handler(req, context);
        } catch (error) {
            const correlationId = req.headers.get('x-correlation-id') || undefined;
            logger.error({ error, correlationId }, 'API Error');

            if (error instanceof ApiError) {
                return NextResponse.json(
                    { error: error.message },
                    { status: error.status }
                ) as any;
            }

            // Handle Zod errors if they bubble up
            if ((error as any).name === 'ZodError') {
                return NextResponse.json(
                    { error: 'Validation Error', details: (error as any).errors },
                    { status: 400 }
                ) as any;
            }

            return NextResponse.json(
                { error: 'Internal Server Error' },
                { status: 500 }
            ) as any;
        }
    };
}

/**
 * Wrapper for API route handlers that require authentication
 */
export function withAuth<T>(handler: AuthenticatedRouteHandler<T>): RouteHandler<T> {
    return async (req: NextRequest, context?: any) => {
        try {
            const session = await auth();

            if (!session || !session.user) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) as any;
            }

            // Chain error handler inside auth
            return await withApiHandler(async (r, c) => handler(r, session, c))(req, context);
        } catch (error) {
            logger.error({ error }, 'Auth Middleware Error');
            return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 }) as any;
        }
    };
}

/**
 * Wrapper for request validation
 */
export function withValidation<T>(
    schema: ZodSchema<T>,
    handler: (data: T, req: NextRequest, context?: any) => Promise<NextResponse>
): RouteHandler {
    return async (req: NextRequest, context?: any) => {
        try {
            const body = await req.json();
            const validation = schema.safeParse(body);

            if (!validation.success) {
                return NextResponse.json(
                    { error: 'Validation Error', details: validation.error.errors },
                    { status: 400 }
                ) as any;
            }

            return await handler(validation.data, req, context);
        } catch (error) {
            if (error instanceof SyntaxError) {
                return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) as any;
            }
            throw error;
        }
    };
}

/**
 * Wrapper for Idempotency
 * Must be used INSIDE withAuth
 */
export function withIdempotency<T>(handler: AuthenticatedRouteHandler<T>): AuthenticatedRouteHandler<T> {
    return async (req: NextRequest, session: any, context?: any) => {
        const key = req.headers.get('x-idempotency-key');
        if (!key) return handler(req, session, context);

        const userId = session.user.id;
        const method = req.method;
        const path = req.nextUrl.pathname;

        try {
            // Check for existing key
            const existing = await prisma.idempotencyKey.findUnique({
                where: { key }
            });

            if (existing) {
                if (existing.userId !== userId) {
                    return NextResponse.json({ error: 'Conflict' }, { status: 409 }) as any;
                }

                if (existing.responseCode) {
                    return NextResponse.json(existing.responseBody, { status: existing.responseCode }) as any;
                }
                return NextResponse.json({ error: 'Request is currently being processed' }, { status: 409 }) as any;
            }

            // Create lock
            await prisma.idempotencyKey.create({
                data: { key, userId, method, path }
            });
        } catch (error) {
            // Handle race condition
            return NextResponse.json({ error: 'Conflict' }, { status: 409 }) as any;
        }

        try {
            const response = await handler(req, session, context);

            // Clone and save
            const cloned = response.clone();
            let body = null;
            try {
                body = await cloned.json();
            } catch {
                try {
                    body = await cloned.text();
                } catch { }
            }

            await prisma.idempotencyKey.update({
                where: { key },
                data: {
                    responseCode: response.status,
                    responseBody: body as any
                }
            });

            return response;
        } catch (error) {
            // Cleanup on error to allow retry
            await prisma.idempotencyKey.delete({ where: { key } }).catch(() => { });
            throw error;
        }
    };
}

/**
 * Wrapper for API route handlers that require BOTH authentication AND validation
 */
export function withAuthValidation<T>(
    schema: ZodSchema<T>,
    handler: (data: T, req: NextRequest, session: any, context?: any) => Promise<NextResponse>
): RouteHandler {
    return withAuth(async (req, session, context) => {
        return withValidation(schema, (data, r, c) => handler(data, r, session, c))(req, context);
    });
}
