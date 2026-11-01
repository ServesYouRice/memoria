/**
 * Better Auth route handler (IMP-041): /api/auth/*
 *
 * Only the endpoints in `ALLOWED_AUTH_PATHS` are routed; see
 * `src/lib/auth/server.ts`.
 */

import { getAuthServer } from "@/lib/auth/server";

function handle(request: Request): Promise<Response> {
  return getAuthServer().handler(request);
}

export { handle as GET, handle as POST };
