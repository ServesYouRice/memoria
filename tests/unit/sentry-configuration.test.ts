import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("explicit Sentry configuration", () => {
  it("does not enable browser telemetry without a public DSN", () => {
    const config = readFileSync("sentry.client.config.ts", "utf8");
    expect(config).toContain("const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN");
    expect(config).toContain("Boolean(dsn)");
    expect(config).not.toContain(
      "dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || ''",
    );
  });

  it("imports server and edge telemetry only when configured", () => {
    const instrumentation = readFileSync("src/instrumentation.ts", "utf8");
    expect(instrumentation).toContain("Boolean(process.env.SENTRY_DSN)");
    expect(instrumentation).toContain(
      'if (sentryEnabled) await import("../sentry.server.config")',
    );
    expect(instrumentation).toContain(
      'process.env.NODE_ENV === "production" && process.env.SENTRY_DSN',
    );
  });

  it("passes an explicitly configured public DSN into the client build", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const compose = readFileSync("docker-compose.yml", "utf8");
    expect(dockerfile).toContain("ARG NEXT_PUBLIC_SENTRY_DSN");
    expect(compose).toContain(
      "NEXT_PUBLIC_SENTRY_DSN: ${NEXT_PUBLIC_SENTRY_DSN:-}",
    );
  });
});
