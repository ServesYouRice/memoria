/**
 * IMP-146 (handbook ME-08, OWN-07): PASSKEYS_ENABLED=false removes passkeys
 * while the app is not on its final domain; on, nothing changes.
 */
import { describe, expect, it, vi } from "vitest";
import { ALLOWED_AUTH_PATHS, allowedAuthPaths } from "@/lib/auth/server";
import { callAuth, CookieJar } from "../helpers/auth-harness";
import { buildMemoryAuth } from "../helpers/memory-auth";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));

describe("passkey switch", () => {
  it("drops every passkey path when off, and keeps them when on", () => {
    expect(allowedAuthPaths(false, true)).toBe(ALLOWED_AUTH_PATHS);
    const off = allowedAuthPaths(false, false);
    expect([...off].some((path) => path.startsWith("/passkey/"))).toBe(false);
    expect(off.has("/sign-in/email")).toBe(true);
    expect(off.has("/two-factor/verify-totp")).toBe(true);
    const offWithSso = allowedAuthPaths(true, false);
    expect(offWithSso.has("/sign-in/social")).toBe(true);
    expect(offWithSso.has("/passkey/verify-authentication")).toBe(false);
  });

  it("answers 404 on passkey routes when off", async () => {
    const { auth } = buildMemoryAuth({ passkeys: false });
    const result = await callAuth(
      auth.handler,
      new CookieJar(),
      "/passkey/generate-authenticate-options",
    );
    expect(result.status).toBe(404);
  });

  it("serves passkey routes when on", async () => {
    const { auth } = buildMemoryAuth();
    const result = await callAuth(
      auth.handler,
      new CookieJar(),
      "/passkey/generate-authenticate-options",
    );
    expect(result.status).toBe(200);
  });
});
