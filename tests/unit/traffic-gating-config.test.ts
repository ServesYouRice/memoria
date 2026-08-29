import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("reference-stack readiness gating", () => {
  it("keeps app operations loopback-only and exposes user traffic through Caddy", () => {
    const compose = readFileSync("docker-compose.yml", "utf8");
    expect(compose).toContain("127.0.0.1:${OPERATIONS_HOST_PORT:-3002}:3000");
    expect(compose).toContain("127.0.0.1:${APP_HOST_PORT:-3000}:3000");
    expect(compose).toContain("gateway:");
    expect(compose).toContain("condition: service_healthy");
  });

  it("uses authenticated readiness for both container and active ingress health", () => {
    const compose = readFileSync("docker-compose.yml", "utf8");
    const caddy = readFileSync("Caddyfile", "utf8");
    expect(compose).toContain(
      "Authorization: Bearer $${INTERNAL_OPERATIONS_TOKEN}",
    );
    expect(compose).toContain("/api/ready");
    expect(caddy).toContain("health_uri /api/ready");
    expect(caddy).toContain(
      'Authorization "Bearer {$INTERNAL_OPERATIONS_TOKEN}"',
    );
    expect(caddy).toContain("path /api/health /api/status");
  });
});
