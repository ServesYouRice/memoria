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

  it("loads the browser Sentry config from the client instrumentation file", async () => {
    // Next.js loads instrumentation-client next to the app directory (src/).
    expect(existsSync("src/instrumentation-client.ts")).toBe(true);
    sentry.init.mockClear();
    vi.resetModules();
    const entry = "../../src/instrumentation-client";
    await import(/* @vite-ignore */ entry);
    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(sentry.init.mock.calls[0]?.[0]).toMatchObject({
      enabled: false,
    });
  });
});
