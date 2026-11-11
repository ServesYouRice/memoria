/**
 * TASK-242 — signed-in callers can use their full per-user canvas and item
 * budgets; anonymous callers keep the 50 / 200 per-IP limits, and rotated
 * cookies are still bounded by a per-IP session ceiling.
 */
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  prisma: { canvasEmbed: { findUnique: vi.fn(async () => null) } },
}));

import {
  CANVASES_USER_RATE_LIMIT_MAX_REQUESTS,
  ITEMS_USER_RATE_LIMIT_MAX_REQUESTS,
} from "@/lib/constants";
import { proxy } from "@/proxy";

let counter = 0;
function freshIp() {
  counter += 1;
  return `198.18.0.${counter}`;
}

function call(path: string, ip: string, token?: string) {
  const headers: Record<string, string> = { "x-memoria-client-ip": ip };
  if (token) headers.cookie = `memoria.session_token=${token}.sig`;
  return proxy(new NextRequest(`http://localhost${path}`, { headers }));
}

async function allowedBefore429(
  path: string,
  ip: string,
  token: (i: number) => string | undefined,
  cap: number,
) {
  for (let i = 0; i < cap; i += 1) {
    if ((await call(path, ip, token(i))).status === 429) return i;
  }
  return cap;
}

describe("canvas and item limits for signed-in callers", () => {
  it("lets one user reach the per-user canvases budget", async () => {
    const count = await allowedBefore429(
      "/api/v1/canvases",
      freshIp(),
      () => "user-canvases-token-abcdef",
      1000,
    );
    expect(count).toBe(CANVASES_USER_RATE_LIMIT_MAX_REQUESTS);
  });

  it("lets one user reach the per-user items budget", async () => {
    const count = await allowedBefore429(
      "/api/v1/canvas-items",
      freshIp(),
      () => "user-items-token-abcdef",
      2000,
    );
    expect(count).toBe(ITEMS_USER_RATE_LIMIT_MAX_REQUESTS);
  });

  it("keeps anonymous callers at 50 canvases and 200 item requests", async () => {
    const ip = freshIp();
    expect(
      await allowedBefore429("/api/v1/canvases", ip, () => undefined, 1000),
    ).toBe(50);
    expect(
      await allowedBefore429("/api/v1/canvas-items", ip, () => undefined, 1000),
    ).toBe(200);
  });

  it("bounds rotated cookies from one IP by the session per-IP ceiling", async () => {
    const ip = freshIp();
    expect(
      await allowedBefore429(
        "/api/v1/canvases",
        ip,
        (i) => `rotated-canvas-${i}-abcdefgh`,
        1000,
      ),
    ).toBe(200);
    expect(
      await allowedBefore429(
        "/api/v1/items",
        ip,
        (i) => `rotated-item-${i}-abcdefgh`,
        2000,
      ),
    ).toBe(800);
  });
});
