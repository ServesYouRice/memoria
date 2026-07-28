import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

describe("/api/health public liveness", () => {
  it("returns only a minimal liveness result", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("does not expose dependency, process, version, or uptime details", async () => {
    const payload = await (await GET()).json();
    expect(payload).not.toHaveProperty("checks");
    expect(payload).not.toHaveProperty("memory");
    expect(payload).not.toHaveProperty("version");
    expect(payload).not.toHaveProperty("uptime");
  });

  it("is never cached", async () => {
    expect((await GET()).headers.get("Cache-Control")).toBe("no-store");
  });
});
