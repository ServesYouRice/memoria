import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGracefulShutdown } from "./graceful-shutdown";

function setup() {
  const calls: string[] = [];
  let finishClose!: () => void;
  const closeServer = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        calls.push("close");
        finishClose = () => {
          calls.push("close-callback");
          resolve();
        };
      }),
  );
  const disconnect = vi.fn(async () => {
    calls.push("disconnect");
  });
  const exit = vi.fn((code: number) => {
    calls.push(`exit(${code})`);
  });
  const logger = { info: vi.fn(), error: vi.fn() };
  const shutdown = createGracefulShutdown({
    closeServer,
    disconnect,
    exit,
    deadlineMs: 20_000,
    logger,
  });
  return {
    calls,
    closeServer,
    disconnect,
    exit,
    logger,
    shutdown,
    finish: () => finishClose(),
  };
}

describe("createGracefulShutdown", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("disconnects only after the HTTP drain and exits 0 last", async () => {
    const t = setup();
    const done = t.shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.disconnect).not.toHaveBeenCalled();
    expect(t.exit).not.toHaveBeenCalled();
    t.finish();
    await done;
    expect(t.calls).toEqual([
      "close",
      "close-callback",
      "disconnect",
      "exit(0)",
    ]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.exit).toHaveBeenCalledTimes(1);
  });

  it("forces exit(1) when the drain outlasts the deadline", async () => {
    const t = setup();
    void t.shutdown("SIGINT");
    await vi.advanceTimersByTimeAsync(19_999);
    expect(t.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.exit).toHaveBeenCalledWith(1);
    expect(t.disconnect).not.toHaveBeenCalled();
  });

  it("ignores repeated signals", async () => {
    const t = setup();
    const first = t.shutdown("SIGTERM");
    void t.shutdown("SIGINT");
    expect(t.closeServer).toHaveBeenCalledTimes(1);
    t.finish();
    await first;
    expect(t.exit).toHaveBeenCalledTimes(1);
  });

  it("still exits 0 when the disconnect fails", async () => {
    const t = setup();
    t.disconnect.mockRejectedValueOnce(new Error("pool gone"));
    const done = t.shutdown("SIGTERM");
    t.finish();
    await done;
    expect(t.logger.error).toHaveBeenCalled();
    expect(t.exit).toHaveBeenCalledWith(0);
  });
});
