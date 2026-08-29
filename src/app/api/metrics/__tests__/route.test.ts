import { beforeAll, describe, expect, it, vi } from "vitest";
import type * as RuntimeMetrics from "@/lib/operations/runtime-metrics";

const operations = vi.hoisted(() => ({
  evaluateReadiness: vi.fn().mockResolvedValue({
    status: "ready",
    checkedAt: new Date().toISOString(),
    checks: [
      { name: "database", effect: "traffic", status: "ok" },
      { name: "migrations", effect: "traffic", status: "ok" },
      { name: "redis", effect: "traffic", status: "ok" },
      { name: "upload-storage", effect: "feature", status: "ok" },
    ],
  }),
  readOperationalCounters: vi.fn().mockResolvedValue({
    http_4xx_total: 1,
    http_5xx_total: 2,
    redis_safety_failures_total: 3,
    websocket_rejected_total: 4,
    outbox_poll_failures_total: 5,
    outbox_handler_timeouts_total: 6,
    outbox_lease_lost_total: 7,
    email_delivery_failures_total: 8,
    backup_freshness_failures_total: 9,
  }),
  readOperationalGauges: vi.fn().mockReturnValue({
    websocket_connections: 10,
    websocket_active_canvases: 2,
  }),
  readBackupSuccessTimestamp: vi.fn().mockResolvedValue(1_700_000_000),
}));
const prisma = vi.hoisted(() => ({
  outboxJob: {
    findFirst: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
  },
  agentAction: { count: vi.fn().mockResolvedValue(12) },
}));

vi.mock("@/lib/operations/readiness", () => ({
  evaluateReadiness: operations.evaluateReadiness,
}));
vi.mock("@/lib/operations/runtime-metrics", async (importOriginal) => {
  const original = await importOriginal<typeof RuntimeMetrics>();
  return {
    ...original,
    readOperationalCounters: operations.readOperationalCounters,
    readOperationalGauges: operations.readOperationalGauges,
    readBackupSuccessTimestamp: operations.readBackupSuccessTimestamp,
  };
});
vi.mock("@/lib/db", () => ({ prisma }));

import { GET } from "@/app/api/metrics/route";

describe("/api/metrics", () => {
  const token = "m".repeat(32);
  beforeAll(() => vi.stubEnv("INTERNAL_OPERATIONS_TOKEN", token));
  const request = () =>
    new Request("http://localhost/api/metrics", {
      headers: { authorization: `Bearer ${token}` },
    });

  it("returns Prometheus text metrics", async () => {
    const response = await GET(request());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(body).toContain("process_cpu_user_seconds_total");
    expect(body).toContain("nodejs_heap_size_total_bytes");
    expect(body).toContain("memoria_readiness_ready 1");
    expect(body).toContain("memoria_storage_available 1");
    expect(body).toContain("memoria_http_5xx_total 2");
    expect(body).toContain("memoria_websocket_connections 10");
    expect(body).toContain("memoria_backup_last_success_timestamp_seconds");
    expect(body).toContain("memoria_ai_action_budget_utilization_ratio");
  });

  it("sets no-cache headers", async () => {
    const response = await GET(request());

    expect(response.headers.get("Cache-Control")).toBe(
      "no-cache, no-store, must-revalidate",
    );
    expect(response.headers.get("Pragma")).toBe("no-cache");
    expect(response.headers.get("Expires")).toBe("0");
  });
});
