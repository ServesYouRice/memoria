import { beforeAll, describe, expect, it, vi } from "vitest";
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
