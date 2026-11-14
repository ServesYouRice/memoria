// @vitest-environment happy-dom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getBrowserSentryConfig,
  readBrowserSentryConfig,
} from "@/lib/telemetry/browser-sentry";

vi.mock("@/lib/nonce", () => ({ getNonce: async () => "test-nonce" }));
vi.mock("@/app/providers", () => ({
  Providers: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/PWARegister", () => ({ PWARegister: () => null }));
vi.mock("@fontsource-variable/figtree", () => ({}));
vi.mock("@fontsource-variable/bricolage-grotesque", () => ({}));
vi.mock("@/app/tiptap.css", () => ({}));

const DSN = "https://publickey@o1.ingest.sentry.io/2";

async function renderLayout(): Promise<string> {
  const { default: RootLayout } = await import("@/app/layout");
  return renderToStaticMarkup(await RootLayout({ children: <main /> }));
}

describe("browser Sentry address at runtime (IMP-151)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is off without a browser DSN, outside production, or with an unusable one", () => {
    expect(getBrowserSentryConfig({ NODE_ENV: "production" })).toBeNull();
    expect(
      getBrowserSentryConfig({
        NODE_ENV: "development",
        SENTRY_BROWSER_DSN: DSN,
      }),
    ).toBeNull();
    expect(
      getBrowserSentryConfig({
        NODE_ENV: "production",
        SENTRY_BROWSER_DSN: "not a url",
      }),
    ).toBeNull();
    // The server-side DSN alone never turns browser telemetry on.
    expect(
      getBrowserSentryConfig({ NODE_ENV: "production", SENTRY_DSN: DSN }),
    ).toBeNull();
  });

  it("carries the DSN, environment and release from the process environment", () => {
    expect(
      getBrowserSentryConfig({
        NODE_ENV: "production",
        SENTRY_BROWSER_DSN: DSN,
        SENTRY_ENVIRONMENT: "staging",
        SENTRY_RELEASE: "abc123",
      }),
    ).toEqual({ dsn: DSN, environment: "staging", release: "abc123" });
  });

  it("renders no Sentry tags when no DSN is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SENTRY_BROWSER_DSN", "");
    const html = await renderLayout();
    expect(html).not.toContain("memoria-sentry");
    expect(html).not.toContain("sentry.io");
  });

  it("renders the runtime DSN into the page for the client entry to read", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SENTRY_BROWSER_DSN", DSN);
    vi.stubEnv("SENTRY_ENVIRONMENT", "production");
    vi.stubEnv("SENTRY_RELEASE", "");
    const html = await renderLayout();
    expect(html).toContain(
      `<meta name="memoria-sentry-dsn" content="${DSN}"/>`,
    );
    expect(html).toContain(
      '<meta name="memoria-sentry-environment" content="production"/>',
    );
    expect(html).not.toContain("memoria-sentry-release");

    // The same markup is what the browser side reads back.
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(readBrowserSentryConfig(doc)).toEqual({
      dsn: DSN,
      environment: "production",
    });
  });
});
