/**
 * IMP-093: the browser button lists the canvases it can save to. The route
 * needs an API key, is rate-limited, and returns names and ids only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  checkApiKeyRateLimit: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/api/api-key-auth", () => ({
  authenticateApiKey: mocks.authenticateApiKey,
  checkApiKeyRateLimit: mocks.checkApiKeyRateLimit,
  getApiKeyRateLimitHeaders: () => ({ "X-RateLimit-Limit": "60" }),
}));
vi.mock("@/lib/db", () => ({
  prisma: { canvas: { findMany: mocks.findMany } },
}));

import { GET } from "@/app/api/v1/extensions/canvases/route";

function request() {
  return new NextRequest("http://localhost/api/v1/extensions/canvases", {
    headers: { "x-api-key": "mk_test_key_value_123456789" },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticateApiKey.mockResolvedValue({
    apiKeyId: "key-1",
    user: { id: "user-1" },
  });
  mocks.checkApiKeyRateLimit.mockResolvedValue({
    allowed: true,
    limit: 60,
    remaining: 59,
    resetAt: 0,
    resetIn: 60,
  });
});

describe("GET /api/v1/extensions/canvases", () => {
  it("lists the owner's canvases, Inbox first, names and ids only", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "c2", name: "Trips", secret: "no" },
      { id: "c1", name: "Inbox" },
    ]);
    const response = await GET(request(), { params: Promise.resolve({}) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      canvases: [
        { id: "c1", name: "Inbox" },
        { id: "c2", name: "Trips" },
      ],
    });
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        select: { id: true, name: true },
      }),
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("refuses a missing or wrong key", async () => {
    mocks.authenticateApiKey.mockResolvedValue(null);
    const response = await GET(request(), { params: Promise.resolve({}) });
    expect(response.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("is rate-limited per key", async () => {
    mocks.checkApiKeyRateLimit.mockResolvedValue({
      allowed: false,
      limit: 60,
      remaining: 0,
      resetAt: 0,
      resetIn: 30,
    });
    const response = await GET(request(), { params: Promise.resolve({}) });
    expect(response.status).toBe(429);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
