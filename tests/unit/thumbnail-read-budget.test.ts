/**
 * TASK-236 — dashboard thumbnail GETs use the assets read budget, so a grid
 * of cards cannot use up the canvases limiter that opening a canvas needs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type * as RateLimitModule from "@/middleware/rate-limit";

const spies = vi.hoisted(() => ({
  canvasesIp: vi.fn(async () => null),
  canvasesUser: vi.fn(async () => null),
  assetIp: vi.fn(async () => null),
  assetUser: vi.fn(async () => null),
}));

vi.mock("@/middleware/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof RateLimitModule>();
  return {
    ...actual,
    canvasesRateLimit: spies.canvasesIp,
    canvasesUserRateLimit: spies.canvasesUser,
    readBudgetLimiters: {
      ...actual.readBudgetLimiters,
      assets: [spies.assetIp, spies.assetUser],
    },
  };
});
vi.mock("@/lib/db", () => ({
  prisma: { canvasEmbed: { findUnique: vi.fn(async () => null) } },
}));

import { classifyReadBudget } from "@/middleware/rate-limit";
import { proxy } from "@/proxy";

beforeEach(() => {
  vi.clearAllMocks();
});

function call(path: string, method = "GET") {
  return proxy(
    new NextRequest(`http://localhost${path}`, {
      method,
      headers: { "x-memoria-client-ip": "203.0.113.200" },
    }),
  );
}

describe("thumbnail read budget", () => {
  it("classifies only GET of the exact thumbnail shape as assets", () => {
    expect(classifyReadBudget("/api/v1/canvases/c1/thumbnail", "GET")).toBe(
      "assets",
    );
    expect(
      classifyReadBudget("/api/v1/canvases/c1/thumbnail", "POST"),
    ).toBeNull();
    expect(
      classifyReadBudget("/api/v1/canvases/c1/thumbnail/x", "GET"),
    ).toBeNull();
    expect(classifyReadBudget("/api/v1/canvases/c1", "GET")).toBeNull();
    expect(classifyReadBudget("/api/v1/canvases", "GET")).toBeNull();
  });

  it("sends thumbnail GETs through the assets limiters only", async () => {
    await call("/api/v1/canvases/c1/thumbnail?v=3");
    expect(spies.assetIp).toHaveBeenCalledTimes(1);
    expect(spies.assetUser).toHaveBeenCalledTimes(1);
    expect(spies.canvasesIp).not.toHaveBeenCalled();
    expect(spies.canvasesUser).not.toHaveBeenCalled();
  });

  it.each([
    ["/api/v1/canvases/c1/thumbnail", "POST"],
    ["/api/v1/canvases/c1", "GET"],
    ["/api/v1/canvases", "GET"],
  ])("keeps %s %s on the canvases limiters", async (path, method) => {
    await call(path, method);
    // Anonymous callers go through the canvases per-IP limiter (TASK-242).
    expect(spies.canvasesIp).toHaveBeenCalledTimes(1);
    expect(spies.assetIp).not.toHaveBeenCalled();
  });
});
