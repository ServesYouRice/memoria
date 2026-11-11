import { afterEach, describe, expect, it, vi } from "vitest";

const adapterArgs = vi.hoisted(() => [] as unknown[]);
vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor(config: unknown) {
      adapterArgs.push(config);
    }
  },
}));
vi.mock("@/generated/prisma/client", () => ({
  PrismaClient: class {
    $on() {}
  },
}));

const URL_BASE = "postgresql://u:p@localhost:5432/db";

async function loadDb(databaseUrl: string) {
  vi.resetModules();
  adapterArgs.length = 0;
  vi.stubEnv("DATABASE_URL", databaseUrl);
  (globalThis as { prisma?: unknown }).prisma = undefined;
  return import("@/lib/db");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("DATABASE_URL pool options", () => {
  it("passes connection_limit and pool_timeout to the pg pool", async () => {
    await loadDb(`${URL_BASE}?connection_limit=5&pool_timeout=20`);
    expect(adapterArgs[0]).toEqual({
      connectionString: `${URL_BASE}?connection_limit=5&pool_timeout=20`,
      max: 5,
      connectionTimeoutMillis: 20_000,
    });
  });

  it("passes nothing extra when neither is set", async () => {
    await loadDb(URL_BASE);
    expect(adapterArgs[0]).toEqual({ connectionString: URL_BASE });
  });

  it("parses each case", async () => {
    const db = (await loadDb(URL_BASE)) as Record<string, unknown>;
    const parse = db.poolOptionsFromDatabaseUrl as (
      url: string,
    ) => Record<string, number>;
    expect(parse).toBeTypeOf("function");
    expect(parse(`${URL_BASE}?connection_limit=5&pool_timeout=20`)).toEqual({
      max: 5,
      connectionTimeoutMillis: 20_000,
    });
    expect(parse(URL_BASE)).toEqual({});
    expect(parse(`${URL_BASE}?pool_timeout=0`)).toEqual({
      connectionTimeoutMillis: 0,
    });
    expect(() => parse(`${URL_BASE}?connection_limit=0`)).toThrow(
      /connection_limit/,
    );
    expect(() => parse(`${URL_BASE}?connection_limit=2.5`)).toThrow(
      /connection_limit/,
    );
    expect(() => parse(`${URL_BASE}?pool_timeout=-1`)).toThrow(/pool_timeout/);
    expect(() => parse(`${URL_BASE}?pool_timeout=abc`)).toThrow(/pool_timeout/);
  });
});
