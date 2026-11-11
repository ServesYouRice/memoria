/**
 * TASK-240 — each strict auth route group has its own per-IP bucket, so
 * spending the sign-in budget does not lock the same IP out of registration,
 * password reset or email verification (and the reverse).
 */
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  prisma: { canvasEmbed: { findUnique: vi.fn(async () => null) } },
}));

import {
  shouldApplyStrictAuthRateLimit,
  strictAuthRateLimitGroup,
} from "@/middleware/auth-rate-limit";
import { proxy } from "@/proxy";

let counter = 0;
function freshIp() {
  counter += 1;
  return `192.0.2.${counter}`;
}

function post(path: string, ip: string, method = "POST") {
  return proxy(
    new NextRequest(`http://localhost:3000${path}`, {
      method,
      headers: { "x-memoria-client-ip": ip },
    }),
  );
}

async function spend(path: string, ip: string) {
  // The default auth budget is 5 per window.
  for (let i = 0; i < 5; i += 1) {
    expect((await post(path, ip)).status).not.toBe(429);
  }
  expect((await post(path, ip)).status).toBe(429);
}

describe("strictAuthRateLimitGroup", () => {
  it.each([
    ["/api/auth/sign-in/email", "POST", "sign-in"],
    ["/api/auth/two-factor/verify-totp", "POST", "two-factor"],
    ["/api/auth/passkey/verify-authentication", "POST", "passkey"],
    ["/api/auth/passkey/verify-registration", "POST", "passkey"],
    ["/api/v1/auth/register", "POST", "registration"],
    ["/api/v1/auth/forgot-password", "POST", "password-reset"],
    ["/api/v1/auth/reset-password", "POST", "password-reset"],
    ["/api/v1/auth/send-verification", "POST", "email-verification"],
    ["/api/v1/auth/verify-email", "POST", "email-verification"],
    ["/api/v1/users/change-password", "POST", "account"],
    ["/api/v1/users/account", "DELETE", "account"],
    ["/api/auth/sign-in/email", "GET", null],
    ["/api/auth/sign-out", "POST", null],
    ["/api/auth/get-session", "GET", null],
  ])("%s %s -> %s", (path, method, group) => {
    expect(strictAuthRateLimitGroup(path, method)).toBe(group);
    expect(shouldApplyStrictAuthRateLimit(path, method)).toBe(group !== null);
  });
});

describe("per-group auth buckets through the proxy", () => {
  it("does not let a spent sign-in budget block the other groups", async () => {
    const ip = freshIp();
    await spend("/api/auth/sign-in/email", ip);
    for (const path of [
      "/api/v1/auth/register",
      "/api/v1/auth/forgot-password",
      "/api/v1/auth/verify-email",
    ]) {
      expect((await post(path, ip)).status).not.toBe(429);
    }
    expect((await post("/api/auth/sign-in/email", ip)).status).toBe(429);
  });

  it("does not let a spent registration budget block sign-in", async () => {
    const ip = freshIp();
    await spend("/api/v1/auth/register", ip);
    expect((await post("/api/auth/sign-in/email", ip)).status).not.toBe(429);
  });

  it("shares one bucket within a group", async () => {
    const ip = freshIp();
    await spend("/api/v1/auth/forgot-password", ip);
    expect((await post("/api/v1/auth/reset-password", ip)).status).toBe(429);
  });

  it("never strictly limits GET or sign-out", async () => {
    const ip = freshIp();
    await spend("/api/auth/sign-in/email", ip);
    expect((await post("/api/auth/sign-out", ip)).status).not.toBe(429);
    expect((await post("/api/auth/sign-in/email", ip, "GET")).status).not.toBe(
      429,
    );
  });
});
