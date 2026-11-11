/**
 * TASK-012: the custom server binds the interface HOSTNAME names, not every
 * interface, and the image pins HOSTNAME so a container (whose runtime sets
 * HOSTNAME to the container's name) still listens on all of its interfaces.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

const listen = vi.hoisted(() => vi.fn());

vi.mock("http", () => ({
  createServer: () => ({ listen, on: vi.fn(), close: vi.fn() }),
}));
vi.mock("next", () => ({
  default: () => ({
    prepare: async () => undefined,
    getRequestHandler: () => () => undefined,
  }),
}));
vi.mock("../../src/lib/env", () => ({}));
vi.mock("../../src/lib/db", () => ({ disconnectDatabase: vi.fn() }));
vi.mock("../../src/lib/logger", () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { logger, createLogger: () => logger };
});

async function startWith(hostname: string, nodeEnv: string) {
  vi.resetModules();
  listen.mockClear();
  vi.stubEnv("HOSTNAME", hostname);
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.stubEnv("PORT", "3123");
  const sigterm = process.listeners("SIGTERM");
  const sigint = process.listeners("SIGINT");
  await import("../../server");
  await vi.waitFor(() => expect(listen).toHaveBeenCalled());
  for (const listener of process.listeners("SIGTERM"))
    if (!sigterm.includes(listener)) process.off("SIGTERM", listener);
  for (const listener of process.listeners("SIGINT"))
    if (!sigint.includes(listener)) process.off("SIGINT", listener);
  return listen.mock.calls[0]!;
}

afterEach(() => vi.unstubAllEnvs());

describe("custom server listener", () => {
  it("binds the configured hostname", async () => {
    const call = await startWith("127.0.0.1", "production");
    expect(call.slice(0, 2)).toEqual([3123, "127.0.0.1"]);
  });

  it("listens on every interface in production when HOSTNAME is unset", async () => {
    const call = await startWith("", "production");
    expect(call.slice(0, 2)).toEqual([3123, "0.0.0.0"]);
  });

  it("pins HOSTNAME in the runtime image", () => {
    const dockerfile = readFileSync(join(process.cwd(), "Dockerfile"), "utf8");
    const runtime = dockerfile.slice(dockerfile.indexOf(" AS runtime"));
    expect(runtime).toMatch(/^ENV .*\bHOSTNAME=0\.0\.0\.0\b/m);
  });
});
