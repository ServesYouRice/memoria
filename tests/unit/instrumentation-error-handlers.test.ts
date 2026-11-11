// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  fatal: vi.fn(),
}));
const captureException = vi.hoisted(() => vi.fn());

vi.mock("@/lib/logger", () => ({ createLogger: () => logger }));
vi.mock("@/middleware/cors", () => ({ validateCorsConfig: vi.fn() }));
vi.mock("@/lib/env", () => ({}));
vi.mock("../../sentry.server.config", () => ({}));
vi.mock("@sentry/nextjs", () => ({ captureException }));

type Handler = (...args: unknown[]) => unknown;

function circularError() {
  const error = new Error("socket hang up") as Error & {
    request?: unknown;
    bytes?: bigint;
  };
  const request: { error?: unknown } = {};
  request.error = error;
  error.request = request;
  error.bytes = 10n;
  return error;
}

describe("global process error handlers", () => {
  const handlers = new Map<string, Handler>();
  let exit: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    handlers.clear();
    logger.error.mockReset();
    captureException.mockReset();
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SENTRY_DSN", "https://public@example.invalid/1");
    vi.spyOn(process, "on").mockImplementation(((
      event: string,
      handler: Handler,
    ) => {
      handlers.set(event, handler);
      return process;
    }) as typeof process.on);
    exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as typeof process.exit);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { register } = await import("@/instrumentation");
    await register();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("logs, reports and exits for a circular BigInt uncaught exception", async () => {
    const error = circularError();
    await expect(
      handlers.get("uncaughtException")!(error),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ stack: error.stack }),
      "Uncaught Exception",
    );
    expect(captureException).toHaveBeenCalledWith(error);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits in production even when the logger throws", async () => {
    logger.error.mockImplementation(() => {
      throw new Error("logger down");
    });
    await handlers.get("uncaughtException")!(new Error("boom"));
    expect(captureException).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("logs and reports a circular BigInt rejection reason", async () => {
    const reason = circularError();
    await expect(
      handlers.get("unhandledRejection")!(reason, Promise.resolve()),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ stack: reason.stack }),
      "Unhandled Promise Rejection",
    );
    expect(captureException).toHaveBeenCalledWith(reason);
  });

  it("still only warns for a client abort", async () => {
    const abort = Object.assign(new Error("aborted"), { code: "ECONNRESET" });
    await handlers.get("uncaughtException")!(abort);
    expect(exit).not.toHaveBeenCalled();
  });
});
