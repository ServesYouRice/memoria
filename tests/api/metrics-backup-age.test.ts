import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readBackupSuccessTimestamp: vi.fn(),
}));

vi.mock("@/lib/operations/internal-auth", () => ({
  hasInternalOperationsAccess: () => true,
}));
vi.mock("@/lib/operations/readiness", () => ({
  evaluateReadiness: async () => ({ status: "ok", checks: [] }),
}));
vi.mock("@/lib/operations/runtime-metrics", () => ({
  OPERATIONAL_COUNTERS: [],
  readBackupSuccessTimestamp: mocks.readBackupSuccessTimestamp,
  readOperationalCounters: async () => ({}),
  readOperationalGauges: () => ({
    websocket_connections: 0,
    websocket_active_canvases: 0,
  }),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    outboxJob: { findFirst: async () => null, count: async () => 0 },
    agentAction: { count: async () => 0 },
  },
}));

import { GET } from "@/app/api/metrics/route";

async function scrape() {
  const res = await GET(new Request("http://localhost/api/metrics"));
  return (await res.text()).split("\n");
}

describe("GET /api/metrics backup age", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports an unknown backup timestamp as +Inf age and known 0", async () => {
    mocks.readBackupSuccessTimestamp.mockResolvedValue(0);
    const lines = await scrape();
    expect(lines).toContain("memoria_backup_age_seconds +Inf");
    expect(lines).toContain("memoria_backup_last_success_known 0");
    expect(lines).toContain("memoria_backup_last_success_timestamp_seconds 0");
  });

  it("reports a finite age and known 1 for a recorded backup", async () => {
    const now = Date.now() / 1_000;
    mocks.readBackupSuccessTimestamp.mockResolvedValue(Math.floor(now) - 60);
    const lines = await scrape();
    const age = lines.find((l) => l.startsWith("memoria_backup_age_seconds "));
    const value = Number(age?.split(" ")[1]);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(59);
    expect(value).toBeLessThan(120);
    expect(lines).toContain("memoria_backup_last_success_known 1");
  });
});
