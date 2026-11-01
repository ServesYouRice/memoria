import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type * as Readiness from "@/lib/operations/readiness";

type ReadinessSnapshot = Readiness.ReadinessSnapshot;

const mocks = vi.hoisted(() => ({ evaluateReadiness: vi.fn() }));

vi.mock("@/lib/operations/readiness", async (importOriginal) => ({
  ...(await importOriginal<typeof Readiness>()),
  evaluateReadiness: mocks.evaluateReadiness,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

function snapshot(status: ReadinessSnapshot["status"]): ReadinessSnapshot {
  return { status, checkedAt: new Date().toISOString(), checks: [] };
}

function statusRequest(ip = "203.0.113.7") {
  return new Request("https://memoria.example/api/status", {
    headers: { "x-memoria-client-ip": ip },
  });
}

async function loadRoute() {
  // A fresh module per test gets a fresh cache and rate-limit window.
  vi.resetModules();
  return import("@/app/api/status/route");
}

describe("GET /api/status", () => {
  // The first import transforms the route's dependency graph; keep that cost
  // out of the per-test timeout.
  beforeAll(async () => {
    await import("@/app/api/status/route");
  }, 60_000);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
    mocks.evaluateReadiness.mockReset();
    mocks.evaluateReadiness.mockImplementation(async () => snapshot("ready"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves one dependency check to every caller inside the cache window", async () => {
    const { GET } = await loadRoute();

    const responses = await Promise.all([
      GET(statusRequest("203.0.113.1")),
      GET(statusRequest("203.0.113.2")),
      GET(statusRequest("203.0.113.3")),
    ]);
    vi.setSystemTime(new Date("2026-11-01T12:00:04Z"));
    const later = await GET(statusRequest("203.0.113.4"));

    expect(mocks.evaluateReadiness).toHaveBeenCalledTimes(1);
    for (const response of [...responses, later]) {
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({
        status: "operational",
        checkedAt: "2026-11-01T12:00:00.000Z",
      });
    }
  });

  it("runs the checks again once the cached result expires", async () => {
    const { GET } = await loadRoute();
    await GET(statusRequest());

    mocks.evaluateReadiness.mockImplementation(async () =>
      snapshot("unavailable"),
    );
    vi.setSystemTime(new Date("2026-11-01T12:00:06Z"));
    const response = await GET(statusRequest());

    expect(mocks.evaluateReadiness).toHaveBeenCalledTimes(2);
    expect((await response.json()).status).toBe("outage");
  });

  it("does not cache a failed evaluation", async () => {
    const { GET } = await loadRoute();
    mocks.evaluateReadiness.mockRejectedValueOnce(new Error("boom"));

    await expect(GET(statusRequest())).rejects.toThrow("boom");
    const response = await GET(statusRequest());

    expect(response.status).toBe(200);
    expect(mocks.evaluateReadiness).toHaveBeenCalledTimes(2);
  });

  it("rate limits each client without touching the dependency checks", async () => {
    const { GET } = await loadRoute();

    for (let i = 0; i < 60; i += 1) {
      expect((await GET(statusRequest())).status).toBe(200);
    }
    const limited = await GET(statusRequest());
    const otherClient = await GET(statusRequest("198.51.100.9"));

    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(limited.headers.get("Cache-Control")).toBe("no-store");
    expect(await limited.json()).toMatchObject({ status: 429 });
    expect(otherClient.status).toBe(200);
    expect(mocks.evaluateReadiness).toHaveBeenCalledTimes(1);
  });
});
