import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  prisma: { canvasEmbed: { findUnique: vi.fn() } },
}));

import { proxy } from "@/proxy";
import { classifyReadBudget, getSessionBucket } from "@/middleware/rate-limit";

/**
 * These drive the real proxy against the real (memory-backed) sliding-window
 * store, so the budgets, keys and fall-through order are exercised together.
 */
let counter = 0;
function caller() {
  counter += 1;
  return {
    ip: `203.0.113.${counter}`,
    token: `session-token-${counter}-abcdefghijkl`,
  };
}

function call(
  path: string,
  who: { ip: string; token?: string },
  method = "GET",
) {
  const headers: Record<string, string> = { "x-memoria-client-ip": who.ip };
  if (who.token) headers.cookie = `memoria.session_token=${who.token}.sig`;
  return proxy(new NextRequest(`http://localhost${path}`, { method, headers }));
}

async function statuses(
  count: number,
  path: string,
  who: { ip: string; token?: string },
) {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push((await call(path, who)).status);
  }
  return out;
}

describe("read budget classification", () => {
  it("only matches exact safe reads", () => {
    expect(classifyReadBudget("/api/v1/uploads/abc", "GET")).toBe("assets");
    expect(classifyReadBudget("/api/v1/uploads/abc", "DELETE")).toBeNull();
    expect(classifyReadBudget("/api/v1/uploads/abc/x", "GET")).toBeNull();
    expect(classifyReadBudget("/api/v1/notifications", "GET")).toBe(
      "notifications",
    );
    expect(classifyReadBudget("/api/v1/notifications", "PATCH")).toBeNull();
    expect(
      classifyReadBudget("/api/v1/notifications/preferences", "GET"),
    ).toBeNull();
    expect(classifyReadBudget("/api/v1/search", "GET")).toBe("search");
  });

  it("derives a hashed session bucket from either cookie name", () => {
    const plain = new NextRequest("http://localhost/api/v1/search", {
      headers: { cookie: "memoria.session_token=tokentoken123.sig" },
    });
    const secure = new NextRequest("http://localhost/api/v1/search", {
      headers: { cookie: "__Secure-memoria.session_token=tokentoken123.sig" },
    });
    const none = new NextRequest("http://localhost/api/v1/search");
    expect(getSessionBucket(plain)).toBe(getSessionBucket(secure));
    expect(getSessionBucket(plain)).toMatch(/^[0-9a-f]{32}$/);
    expect(getSessionBucket(plain)).not.toContain("tokentoken");
    expect(getSessionBucket(none)).toBeNull();
  });
});

describe("rate limit budgets through the proxy", () => {
  it("loads a 150-image canvas without a 429", async () => {
    const who = caller();
    const results = await statuses(150, "/api/v1/uploads/asset-1", who);
    expect(results.every((status) => status !== 429)).toBe(true);
  });

  it("serves asset reads for anonymous public-canvas viewers too", async () => {
    const who = { ip: caller().ip };
    const results = await statuses(150, "/api/v1/uploads/asset-1", who);
    expect(results.every((status) => status !== 429)).toBe(true);
  });

  it("keeps asset and poll traffic from exhausting the general budget", async () => {
    const who = caller();
    await statuses(200, "/api/v1/uploads/asset-1", who);
    await statuses(20, "/api/v1/notifications?limit=1", who);
    const general = await call("/api/v1/workspaces", who);
    expect(general.status).not.toBe(429);
  });

  it("allows several tabs polling unread notifications every 30s", async () => {
    const who = caller();
    // 10 tabs * 2 polls/min
    const results = await statuses(20, "/api/v1/notifications", who);
    expect(results.every((status) => status !== 429)).toBe(true);
  });

  it("still limits runaway asset reads per user", async () => {
    const who = caller();
    const results = await statuses(601, "/api/v1/uploads/asset-1", who);
    expect(results.at(-1)).toBe(429);
    expect(results.slice(0, 600).every((status) => status !== 429)).toBe(true);
  });

  it("limits notification polling and search per user, across IPs", async () => {
    const first = caller();
    const second = caller();
    const shared = first.token;
    await statuses(60, "/api/v1/search", first);
    // Same session arriving from another IP shares the per-user bucket.
    const blocked = await call("/api/v1/search", {
      ip: second.ip,
      token: shared,
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).not.toBeNull();

    const other = caller();
    expect((await call("/api/v1/search", other)).status).not.toBe(429);
  });

  it("does not let one user's traffic starve another user on the same IP", async () => {
    const heavy = caller();
    const light = { ip: heavy.ip, token: caller().token };
    await statuses(61, "/api/v1/notifications", heavy);
    expect((await call("/api/v1/notifications", light)).status).not.toBe(429);
  });

  it("keeps the per-IP ceiling for requests with rotated or forged cookies", async () => {
    const ip = caller().ip;
    let last = 0;
    for (let i = 0; i < 121; i += 1) {
      last = (
        await call("/api/v1/search", {
          ip,
          token: `forged-token-${ip}-${i}-xxxxxxxx`,
        })
      ).status;
    }
    expect(last).toBe(429);
  });

  it("keeps the strict general budget for anonymous callers", async () => {
    const who = { ip: caller().ip };
    const results = await statuses(101, "/api/v1/workspaces", who);
    expect(results.slice(0, 100).every((status) => status !== 429)).toBe(true);
    expect(results[100]).toBe(429);
  });

  it("gives signed-in users a per-user general budget above the anonymous one", async () => {
    const who = caller();
    const results = await statuses(150, "/api/v1/workspaces", who);
    expect(results.every((status) => status !== 429)).toBe(true);
  });

  it("leaves auth limits unchanged", async () => {
    const who = { ip: caller().ip };
    const results: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      results.push((await call("/api/auth/sign-in/email", who, "POST")).status);
    }
    expect(results.slice(0, 5).every((status) => status !== 429)).toBe(true);
    expect(results[5]).toBe(429);
  });
});
