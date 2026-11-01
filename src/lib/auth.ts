/**
 * Session access for route handlers and server components.
 *
 * Better Auth (IMP-041) issues server-side sessions in secure, signed cookies.
 * `auth()` reads the current request's session through the shared helper in
 * `@/lib/auth/session`, which is also what the WebSocket upgrade uses.
 */

import { headers } from "next/headers";
import {
  getSessionFromHeaders,
  type AuthSession,
  type AuthUser,
} from "@/lib/auth/session";

export type { AuthSession, AuthUser };

/** The signed-in session for the current request, or null. */
export async function auth(): Promise<AuthSession | null> {
  return getSessionFromHeaders(await headers());
}
