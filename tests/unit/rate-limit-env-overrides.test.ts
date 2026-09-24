import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `src/middleware/rate-limit.ts` resolves every ceiling at module scope, so the
 * override has to be observed by re-importing the module with a different
 * environment rather than by calling an exported helper.
 */
const { createdConfigs } = vi.hoisted(() => ({
  createdConfigs: [] as Array<{
    maxRequests: number;
    windowSeconds: number;
    keyPrefix?: string;
  }>,
}));

vi.mock("@/lib/rate-limit", () => ({
  createRateLimiter: (config: {
    maxRequests: number;
    windowSeconds: number;
    keyPrefix?: string;
  }) => {
    createdConfigs.push(config);
    return {
      check: async () => ({ allowed: true, remaining: 1, resetAt: 0 }),
    };
  },
}));

const ORIGINAL_ENV = { ...process.env };

async function loadCeilings() {
  createdConfigs.length = 0;
  vi.resetModules();
  await import("@/middleware/rate-limit");
  return new Map(createdConfigs.map((config) => [config.keyPrefix, config]));
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe("rate limit environment overrides", () => {
  it("falls back to the production ceilings when nothing is set", async () => {
    delete process.env.API_RATE_LIMIT_MAX_REQUESTS;
    delete process.env.UPLOAD_RATE_LIMIT_MAX_REQUESTS;

    const ceilings = await loadCeilings();

    expect(ceilings.get("api")).toMatchObject({
      maxRequests: 100,
      windowSeconds: 15 * 60,
    });
    expect(ceilings.get("upload")).toMatchObject({
      maxRequests: 10,
      windowSeconds: 60 * 60,
    });
  });

  it("honours the configured ceilings so a test stack can lift them", async () => {
    process.env.API_RATE_LIMIT_MAX_REQUESTS = "100000";
    process.env.UPLOAD_RATE_LIMIT_MAX_REQUESTS = "10000";

    const ceilings = await loadCeilings();

    expect(ceilings.get("api")?.maxRequests).toBe(100_000);
    expect(ceilings.get("upload")?.maxRequests).toBe(10_000);
  });

  it("keeps the window fixed when only the ceiling is raised", async () => {
    process.env.API_RATE_LIMIT_MAX_REQUESTS = "100000";
    process.env.UPLOAD_RATE_LIMIT_MAX_REQUESTS = "10000";

    const ceilings = await loadCeilings();

    expect(ceilings.get("api")?.windowSeconds).toBe(15 * 60);
    expect(ceilings.get("upload")?.windowSeconds).toBe(60 * 60);
  });

  it.each(["0", "-1", "not-a-number", "1.5", ""])(
    "ignores the unusable value %j and keeps the production ceiling",
    async (value) => {
      process.env.API_RATE_LIMIT_MAX_REQUESTS = value;
      process.env.UPLOAD_RATE_LIMIT_MAX_REQUESTS = value;

      const ceilings = await loadCeilings();

      expect(ceilings.get("api")?.maxRequests).toBe(100);
      expect(ceilings.get("upload")?.maxRequests).toBe(10);
    },
  );

  it("leaves the auth ceiling on its own independent override", async () => {
    process.env.API_RATE_LIMIT_MAX_REQUESTS = "100000";
    delete process.env.AUTH_RATE_LIMIT_MAX_REQUESTS;

    const ceilings = await loadCeilings();

    expect(ceilings.get("auth")?.maxRequests).toBe(5);
  });
});
