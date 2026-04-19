/**
 * Session Caching for API Routes
 *
 * FIXED: Issue #25 - Inefficient session checks
 *
 * Prevents multiple database calls to fetch the same session within a single request.
 * Uses AsyncLocalStorage to cache session data per-request.
 *
 * Usage:
 * ```typescript
 * // In API route
 * const session = await getCachedSession();
 * if (!session) {
 *   return unauthorized();
 * }
 * ```
 *
 * The first call fetches from database, subsequent calls return cached value.
 */

import { AsyncLocalStorage } from "async_hooks";
import { auth } from "@/lib/auth";
import type { Session } from "next-auth";

// AsyncLocalStorage for request-scoped session caching
const sessionStorage = new AsyncLocalStorage<Map<string, Session | null>>();

/**
 * Get or create the session cache for the current request
 */
function getSessionCache(): Map<string, Session | null> | null {
  return sessionStorage.getStore() ?? null;
}

export async function runWithSessionCache<T>(fn: () => Promise<T>): Promise<T> {
  return sessionStorage.run(new Map(), fn);
}

/**
 * Get the current session with caching
 *
 * On first call within a request: fetches from database
 * On subsequent calls: returns cached value
 *
 * @returns Session object if authenticated, null otherwise
 *
 * @example
 * ```typescript
 * // Multiple calls in same request only hit DB once
 * const session1 = await getCachedSession(); // DB query
 * const session2 = await getCachedSession(); // From cache
 * const session3 = await getCachedSession(); // From cache
 * ```
 */
export async function getCachedSession(): Promise<Session | null> {
  const cache = getSessionCache();
  const cacheKey = "current-session";

  // Return cached value if available
  if (cache?.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  // Fetch from database
  const session = await auth();

  // Cache for subsequent calls
  cache?.set(cacheKey, session);

  return session;
}

/**
 * Clear the session cache for the current request
 *
 * Useful for testing or when session is explicitly invalidated
 */
export function clearSessionCache(): void {
  const cache = getSessionCache();
  cache?.clear();
}

/**
 * Helper to require authentication in API routes
 *
 * @throws Response with 401 if not authenticated
 * @returns Session object
 *
 * @example
 * ```typescript
 * export async function GET(request: NextRequest) {
 *   const session = await requireCachedAuth();
 *   // session is guaranteed to be non-null here
 *   return NextResponse.json({ userId: session.user.id });
 * }
 * ```
 */
export async function requireCachedAuth(): Promise<Required<Session>> {
  const session = await getCachedSession();

  if (!session?.user) {
    // This will be caught by error handler middleware
    throw new Error("Unauthorized");
  }

  return session as Required<Session>;
}

/**
 * Check if the current request is authenticated
 *
 * @returns true if authenticated, false otherwise
 *
 * @example
 * ```typescript
 * if (await isAuthenticated()) {
 *   // Show user-specific data
 * } else {
 *   // Show public data
 * }
 * ```
 */
export async function isAuthenticated(): Promise<boolean> {
  const session = await getCachedSession();
  return session?.user != null;
}

/**
 * Get the current user ID with caching
 *
 * @returns User ID if authenticated, null otherwise
 *
 * @example
 * ```typescript
 * const userId = await getCurrentUserId();
 * if (userId) {
 *   // User is authenticated
 * }
 * ```
 */
export async function getCurrentUserId(): Promise<string | null> {
  const session = await getCachedSession();
  return session?.user?.id ?? null;
}
