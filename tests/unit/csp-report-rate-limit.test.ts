/**
 * TASK-241 — browser CSP reports have their own per-IP bucket, so they
 * cannot use up the OAuth/setup budget (and the reverse).
 */
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  prisma: { canvasEmbed: { findUnique: vi.fn(async () => null) } },
}));

import { proxy } from "@/proxy";

let counter = 0;
function freshIp() {
  counter += 1;
  return `192.0.2.${100 + counter}`;
}

function post(path: string, ip: string) {
  return proxy(
    new NextRequest(`http://localhost:3000${path}`, {
      method: "POST",
      headers: { "x-memoria-client-ip": ip },
    }),
  );
}

async function spend(path: string, ip: string) {
  for (let i = 0; i < 20; i += 1) {
    expect((await post(path, ip)).status).not.toBe(429);
  }
  expect((await post(path, ip)).status).toBe(429);
}

describe("CSP report rate limit", () => {
  it("does not let CSP reports use up the OAuth and setup budget", async () => {
    const ip = freshIp();
    await spend("/api/csp-report", ip);
    expect((await post("/api/oauth/token", ip)).status).not.toBe(429);
    expect((await post("/api/setup", ip)).status).not.toBe(429);
    expect((await post("/api/csp-report", ip)).status).toBe(429);
  });

  it("does not let OAuth traffic block CSP reports", async () => {
    const ip = freshIp();
    await spend("/api/oauth/token", ip);
    expect((await post("/api/csp-report", ip)).status).not.toBe(429);
    expect((await post("/api/setup", ip)).status).toBe(429);
  });
});
