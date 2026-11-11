import { beforeEach, describe, expect, it, vi } from "vitest";

const redis = vi.hoisted(() => ({
  setex: vi.fn(async () => "OK"),
  get: vi.fn(async () => null),
  del: vi.fn(async () => 1),
}));
vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => redis }));

import { setCachedUnfurl } from "@/lib/cache/unfurl-cache";

async function keyFor(url: string): Promise<string> {
  redis.setex.mockClear();
  await setCachedUnfurl(url, { title: "t" });
  return (redis.setex.mock.calls[0] as unknown as [string])[0];
}

describe("unfurl cache key", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps path case distinct", async () => {
    expect(await keyFor("https://x.com/AbC")).not.toBe(
      await keyFor("https://x.com/abc"),
    );
  });

  it("keeps query value case distinct", async () => {
    expect(await keyFor("https://youtu.be/watch?v=dQw4w9WgXcQ")).not.toBe(
      await keyFor("https://youtu.be/watch?v=DQW4W9WGXCQ"),
    );
  });

  it("keeps repeated query parameters", async () => {
    expect(await keyFor("https://x.com/p?a=1&a=2")).not.toBe(
      await keyFor("https://x.com/p?a=2"),
    );
  });

  it("normalizes scheme and host case", async () => {
    expect(await keyFor("HTTPS://X.COM/p")).toBe(
      await keyFor("https://x.com/p"),
    );
  });

  it("uses a versioned prefix so collided entries are not served", async () => {
    expect(await keyFor("https://x.com/p")).toMatch(/^unfurl:v2:/);
  });
});
