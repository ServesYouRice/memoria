/**
 * IMP-147 (handbook RUN-ME-3): the scheduler retries a failed cron call within
 * SCHEDULER_RETRY_MS instead of waiting a full interval.
 */
import { spawn, type ChildProcess } from "child_process";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";

let server: Server | undefined;
let child: ChildProcess | undefined;

afterEach(async () => {
  child?.kill("SIGKILL");
  child = undefined;
  await new Promise<void>((resolve) =>
    server ? server.close(() => resolve()) : resolve(),
  );
  server = undefined;
});

async function startCronStub(failFirst: number) {
  const calls: { path: string; at: number }[] = [];
  server = createServer((req, res) => {
    calls.push({ path: req.url ?? "", at: Date.now() });
    const failing =
      calls.filter((call) => call.path === "/api/cron/version-history")
        .length <= failFirst;
    res.statusCode =
      req.url === "/api/cron/version-history" && failing ? 503 : 200;
    res.end();
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { calls, baseUrl: `http://127.0.0.1:${port}` };
}

function startScheduler(env: Record<string, string>) {
  child = spawn(
    process.execPath,
    [join(process.cwd(), "scripts/scheduler.mjs")],
    {
      env: { ...process.env, CRON_SECRET: "test-secret", ...env },
      stdio: "ignore",
    },
  );
}

describe("scheduler retry", () => {
  it("retries a failed call after SCHEDULER_RETRY_MS, not a full interval", async () => {
    const { calls, baseUrl } = await startCronStub(1);
    startScheduler({ SCHEDULER_BASE_URL: baseUrl, SCHEDULER_RETRY_MS: "1000" });
    await expect
      .poll(
        () =>
          calls.filter((call) => call.path === "/api/cron/version-history")
            .length,
        { timeout: 8_000, interval: 100 },
      )
      .toBeGreaterThanOrEqual(2);
    const version = calls.filter(
      (call) => call.path === "/api/cron/version-history",
    );
    expect(version[1]!.at - version[0]!.at).toBeLessThan(5_000);
    // The healthy task is not retried early: its interval is 15 minutes.
    expect(
      calls.filter((call) => call.path === "/api/cron/maintenance"),
    ).toHaveLength(1);
  }, 15_000);

  it("refuses a retry delay under one second", async () => {
    startScheduler({ SCHEDULER_RETRY_MS: "10" });
    const code = await new Promise<number | null>((resolve) =>
      child!.once("exit", resolve),
    );
    expect(code).not.toBe(0);
  });
});
