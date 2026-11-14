// @vitest-environment happy-dom
import React from "react";
import { existsSync } from "node:fs";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  init: vi.fn(),
  replayIntegration: vi.fn(() => ({ name: "Replay" })),
}));

vi.mock("@sentry/nextjs", () => sentry);

import AppError from "@/app/error";
import GlobalError from "@/app/global-error";

describe("App Router error boundaries report to Sentry", () => {
  afterEach(() => {
    cleanup();
    sentry.captureException.mockClear();
    vi.restoreAllMocks();
  });

  it("error.tsx passes the caught error to Sentry.captureException", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("render failed"), { digest: "d1" });
    render(<AppError error={error} reset={() => {}} />);
    expect(sentry.captureException).toHaveBeenCalledWith(error);
  });

  it("global-error.tsx passes the caught error to Sentry.captureException", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("layout failed"), { digest: "d2" });
    render(<GlobalError error={error} reset={() => {}} />, {
      container: document.documentElement,
    });
    expect(sentry.captureException).toHaveBeenCalledWith(error);
  });

  it("loads the browser Sentry config from the client instrumentation file only when configured", async () => {
    // Next.js loads instrumentation-client next to the app directory (src/).
    expect(existsSync("src/instrumentation-client.ts")).toBe(true);
    const entry = "../../src/instrumentation-client";
    const clearTags = () =>
      document.head
        .querySelectorAll('meta[name^="memoria-sentry"]')
        .forEach((tag) => tag.remove());

    try {
      // IMP-116: without a rendered DSN no Sentry code is loaded at all,
      // even in a production build.
      clearTags();
      sentry.init.mockClear();
      vi.resetModules();
      vi.stubEnv("NODE_ENV", "production");
      await import(/* @vite-ignore */ entry);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(sentry.init).not.toHaveBeenCalled();

      // IMP-151: the DSN the server rendered at request time turns it on.
      document.head.insertAdjacentHTML(
        "beforeend",
        '<meta name="memoria-sentry-dsn" content="https://key@sentry.example/1">' +
          '<meta name="memoria-sentry-environment" content="staging">',
      );
      sentry.init.mockClear();
      vi.resetModules();
      await import(/* @vite-ignore */ entry);
      await vi.waitFor(() => expect(sentry.init).toHaveBeenCalledTimes(1));
      expect(sentry.init.mock.calls[0]?.[0]).toMatchObject({
        enabled: true,
        dsn: "https://key@sentry.example/1",
        environment: "staging",
      });

      // A development build never loads it, even with the tag.
      sentry.init.mockClear();
      vi.resetModules();
      vi.stubEnv("NODE_ENV", "development");
      await import(/* @vite-ignore */ entry);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(sentry.init).not.toHaveBeenCalled();
    } finally {
      clearTags();
      vi.unstubAllEnvs();
    }
  });
});
