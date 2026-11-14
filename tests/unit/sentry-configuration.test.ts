import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("explicit Sentry configuration", () => {
  it("does not enable browser telemetry without a runtime DSN", () => {
    const config = readFileSync("sentry.client.config.ts", "utf8");
    expect(config).toContain("dsn: config.dsn");
    expect(config).toContain("Boolean(config.dsn)");
    expect(config).not.toContain("NEXT_PUBLIC_SENTRY_DSN");
  });

  it("loads browser telemetry only when configured, outside the shared JavaScript (IMP-116)", () => {
    const client = readFileSync("src/instrumentation-client.ts", "utf8");
    expect(client).toContain("readBrowserSentryConfig(document)");
    expect(client).toContain('await import("../sentry.client.config")');
    expect(client).not.toMatch(/^import ["']\.\.\/sentry\.client\.config["']/m);
    expect(client).not.toMatch(/^import [^;]*@sentry/m);
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

  it("reads the browser DSN at runtime, not from a build argument (IMP-151)", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const compose = readFileSync("docker-compose.yml", "utf8");
    const small = readFileSync("docker-compose.small.yml", "utf8");
    for (const file of [dockerfile, compose, small]) {
      expect(file).not.toContain("NEXT_PUBLIC_SENTRY_DSN");
    }
    expect(dockerfile).not.toMatch(/^ARG .*SENTRY/m);
    expect(compose).toContain("SENTRY_BROWSER_DSN: ${SENTRY_BROWSER_DSN:-}");
    expect(small).toContain("SENTRY_BROWSER_DSN: ${SENTRY_BROWSER_DSN:-}");
  });

  it("has no Vercel Analytics (IMP-151)", () => {
    const pkg = readFileSync("package.json", "utf8");
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    expect(pkg).not.toContain("@vercel/analytics");
    expect(layout).not.toContain("@vercel/analytics");
  });
});
