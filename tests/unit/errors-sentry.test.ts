/**
 * TASK-175 — server-side 5xx ApiErrors reach Sentry, 4xx ApiErrors do not,
 * and the server config no longer drops dependency-outage (ECONNREFUSED)
 * events.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  init: vi.fn(),
  withScope: vi.fn((run: (scope: { setTag: () => void }) => void) =>
    run({ setTag: vi.fn() }),
  ),
}));
vi.mock("@sentry/nextjs", () => sentry);

import {
  BadRequestError,
  errorResponse,
  InternalServerError,
  NotFoundError,
  ServiceUnavailableError,
} from "@/lib/errors";

describe("errorResponse Sentry reporting", () => {
  beforeEach(() => {
    sentry.captureException.mockClear();
  });

  it.each([
    ["InternalServerError", () => new InternalServerError("contract broke")],
    ["ServiceUnavailableError", () => new ServiceUnavailableError("down")],
  ])("captures a %s once", (_name, make) => {
    const error = make();
    const response = errorResponse(error, "/api/v1/x");
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledWith(error);
  });

  it.each([
    ["BadRequestError", () => new BadRequestError("bad")],
    ["NotFoundError", () => new NotFoundError("missing")],
  ])("does not capture a %s", (_name, make) => {
    errorResponse(make(), "/api/v1/x");
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it("still captures a plain Error once", () => {
    const error = new Error("boom");
    expect(errorResponse(error).status).toBe(500);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });
});

describe("sentry.server.config", () => {
  it("does not discard ECONNREFUSED events", async () => {
    sentry.init.mockClear();
    await import("../../sentry.server.config");
    const options = sentry.init.mock.calls[0]![0] as {
      beforeSend?: (event: unknown) => unknown;
    };
    const event = {
      exception: { values: [{ value: "connect ECONNREFUSED 127.0.0.1:6379" }] },
    };
    const kept = options.beforeSend ? options.beforeSend(event) : event;
    expect(kept).toBe(event);
  });
});
