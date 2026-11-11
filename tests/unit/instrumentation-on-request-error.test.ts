import { afterEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({ captureRequestError: vi.fn() }));
vi.mock("@sentry/nextjs", () => sentry);

import * as srcInstrumentation from "@/instrumentation";
import * as rootInstrumentation from "../../instrumentation";

const request = { path: "/canvas/1", method: "GET", headers: {} };
const context = {
  routerKind: "App Router",
  routePath: "/canvas/[id]",
  routeType: "render",
};

type Hook = (
  error: unknown,
  request: typeof request,
  context: typeof context,
) => Promise<void>;
const hook = (module: object) =>
  (module as { onRequestError?: Hook }).onRequestError;

describe("onRequestError instrumentation hook", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    sentry.captureRequestError.mockReset();
  });

  it("is exported from the src and root instrumentation files", () => {
    expect(hook(srcInstrumentation)).toBeTypeOf("function");
    expect(hook(rootInstrumentation)).toBe(hook(srcInstrumentation));
  });

  it("reports server request errors to Sentry in production with a DSN", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.sentry.io/1");
    const error = new Error("server render failed");
    await hook(srcInstrumentation)?.(error, request, context);
    expect(sentry.captureRequestError).toHaveBeenCalledWith(
      error,
      request,
      context,
    );
  });

  it("stays silent without a DSN and never throws when reporting fails", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SENTRY_DSN", "");
    await hook(srcInstrumentation)?.(new Error("x"), request, context);
    expect(sentry.captureRequestError).not.toHaveBeenCalled();

    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.sentry.io/1");
    sentry.captureRequestError.mockImplementation(() => {
      throw new Error("sentry down");
    });
    await expect(
      hook(srcInstrumentation)?.(new Error("x"), request, context),
    ).resolves.toBeUndefined();
  });
});
