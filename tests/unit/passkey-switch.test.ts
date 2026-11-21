/**
 * IMP-146 (handbook ME-08, OWN-07): PASSKEYS_ENABLED=false removes passkeys
 * while the app is not on its final domain; on, nothing changes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
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

  // IMP-157 (handbook CHK-ME-2): the cluster relies on this switch until the
  // final domain, so every passkey endpoint must refuse, not just one.
  it("refuses every passkey endpoint when off", async () => {
    const { auth } = buildMemoryAuth({ passkeys: false });
    const passkeyPaths = [...ALLOWED_AUTH_PATHS].filter((path) =>
      path.startsWith("/passkey/"),
    );
    expect(passkeyPaths.length).toBeGreaterThanOrEqual(7);
    for (const path of passkeyPaths) {
      for (const method of ["GET", "POST"] as const) {
        const result = await callAuth(auth.handler, new CookieJar(), path, {
          method,
          ...(method === "POST" ? { body: {} } : {}),
        });
        expect(result.status, `${method} ${path}`).toBe(404);
      }
    }
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

describe("PASSKEYS_ENABLED setting", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadSwitch(value: string | undefined) {
    vi.resetModules();
    vi.stubEnv("PASSKEYS_ENABLED", value);
    const { passkeysEnabled } = await import("@/lib/auth/server");
    return passkeysEnabled();
  }

  it("turns passkeys off with false, as the cluster sets it", async () => {
    expect(await loadSwitch("false")).toBe(false);
  });

  // Self-hosters on their own domain rely on the default (DEPLOYMENT.md).
  it("keeps passkeys on when unset or true", async () => {
    expect(await loadSwitch(undefined)).toBe(true);
    expect(await loadSwitch("true")).toBe(true);
  });
});
