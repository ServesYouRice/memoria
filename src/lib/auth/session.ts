/**
 * The one place that turns request headers into a Memoria session.
 *
 * Route handlers and server components reach it through `auth()` in
 * `@/lib/auth`; the WebSocket upgrade calls `getSessionFromHeaders` directly
 * with the upgrade request's headers. The request proxy (`src/proxy.ts`) does
 * not read sessions. Sessions are server-side rows looked up on every call
 * (no cookie cache), so deleting a Session row revokes it everywhere at once.
 *
 * This module must not import `next/headers`: the WebSocket server runs
 * outside a Next.js request scope.
 */

import { getAuthServer } from "@/lib/auth/server";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
}

export interface AuthSession {
  user: AuthUser;
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
  };
}

export interface ReadSessionOptions {
  /**
   * Slide the session expiry when it is due. Off for the WebSocket upgrade,
   * which cannot deliver a refreshed cookie.
   */
  refresh?: boolean;
}

export async function getSessionFromHeaders(
  headers: Headers,
  options: ReadSessionOptions = {},
): Promise<AuthSession | null> {
  const result = await getAuthServer().api.getSession({
    headers,
    query: {
      disableCookieCache: true,
      disableRefresh: options.refresh === false,
    },
  });
  if (!result?.user?.id || !result.session?.id) return null;

  const { user, session } = result;
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name ?? null,
      image: user.image ?? null,
      emailVerified: Boolean(user.emailVerified),
      twoFactorEnabled: Boolean(
        (user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled,
      ),
    },
    session: {
      id: session.id,
      userId: session.userId,
      expiresAt: new Date(session.expiresAt),
    },
  };
}

/** Build a Headers object from a Node `IncomingMessage` header map. */
export function headersFromNode(
  raw: Record<string, string | string[] | undefined>,
): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}
