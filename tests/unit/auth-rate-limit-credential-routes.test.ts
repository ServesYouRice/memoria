/**
 * TASK-237 — password change and account deletion check the current
 * password, so they go through the strict auth limiter too.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type * as RateLimitModule from "@/middleware/rate-limit";

const spies = vi.hoisted(() => ({ strict: vi.fn(async () => null) }));
vi.mock("@/middleware/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof RateLimitModule>();
  return {
    ...actual,
    authGroupRateLimits: {
      ...actual.authGroupRateLimits,
      account: spies.strict,
    },
  };
});
vi.mock("@/lib/db", () => ({
  prisma: { canvasEmbed: { findUnique: vi.fn(async () => null) } },
}));

import { shouldApplyStrictAuthRateLimit } from "@/middleware/auth-rate-limit";
import { proxy } from "@/proxy";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("shouldApplyStrictAuthRateLimit credential routes", () => {
  it.each([
    ["POST", "/api/v1/users/change-password", true],
    ["DELETE", "/api/v1/users/account", true],
    ["delete", "/api/v1/users/account", true],
    ["GET", "/api/v1/users/account", false],
    ["POST", "/api/v1/users/account", false],
    ["GET", "/api/v1/users/change-password", false],
    ["POST", "/api/v1/users/account/exports", false],
    ["DELETE", "/api/v1/users/account/exports", false],
    ["DELETE", "/api/auth/sign-in/email", false],
    ["POST", "/api/auth/sign-in/email", true],
    ["POST", "/api/auth/two-factor/verify-totp", true],
    ["GET", "/api/auth/get-session", false],
    ["POST", "/api/v1/auth/register", true],
    ["POST", "/api/v1/canvases", false],
  ])("%s %s -> %s", (method, path, expected) => {
    expect(shouldApplyStrictAuthRateLimit(path, method)).toBe(expected);
  });

  it("applies the strict limiter in the proxy for DELETE /api/v1/users/account", async () => {
    await proxy(
      new NextRequest("http://localhost/api/v1/users/account", {
        method: "DELETE",
      }),
    );
    expect(spies.strict).toHaveBeenCalledTimes(1);
  });

  it("does not apply it for GET /api/v1/users/account", async () => {
    await proxy(new NextRequest("http://localhost/api/v1/users/account"));
    expect(spies.strict).not.toHaveBeenCalled();
  });
});
