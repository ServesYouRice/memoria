/**
 * TASK-239 — every response proxy() returns before NextResponse.next()
 * (rate-limit 429s and the unsupported-version 400) carries the request id,
 * CORS, the security headers and a CSP that forbids framing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.hoisted(() => {
  process.env.AUTH_RATE_LIMIT_MAX_REQUESTS = "1";
  process.env.CANVASES_RATE_LIMIT_MAX_REQUESTS = "1";
  process.env.API_RATE_LIMIT_MAX_REQUESTS = "1";
});

const framing = vi.hoisted(() => ({ findUnique: vi.fn(async () => null) }));
vi.mock("@/lib/db", () => ({
  prisma: { canvasEmbed: { findUnique: framing.findUnique } },
}));

import { SECURITY_HEADERS } from "@/lib/security/headers";
import { proxy } from "@/proxy";

const ALLOWED = "http://localhost:3000";
let counter = 0;

function call(
  path: string,
  options: {
    method?: string;
    origin?: string;
    requestId?: string;
    ip?: string;
  },
) {
  const headers: Record<string, string> = {
    "x-memoria-client-ip": options.ip ?? "198.51.100.1",
  };
  if (options.origin) headers.origin = options.origin;
  if (options.requestId) headers["x-request-id"] = options.requestId;
  return proxy(
    new NextRequest(`http://localhost:3000${path}`, {
      method: options.method ?? "GET",
      headers,
    }),
  );
}

async function exhaust(path: string, method: string, ip: string) {
  for (let i = 0; i < 5; i += 1) {
    const response = await call(path, { method, ip, origin: ALLOWED });
    if (response.status === 429) return;
  }
  throw new Error(`no 429 for ${method} ${path}`);
}

function expectSecured(response: Response) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    expect(response.headers.get(name)).toBe(value);
  }
  const csp = response.headers.get("Content-Security-Policy");
  expect(csp).toContain("frame-ancestors 'none'");
}

beforeEach(() => {
  counter += 1;
  framing.findUnique.mockClear();
});

describe.each([
  ["auth", "POST", "/api/v1/auth/register"],
  ["canvases", "GET", "/api/v1/canvases"],
  ["general API", "GET", "/api/v1/tags"],
])("%s 429", (_label, method, path) => {
  it("carries CORS, request id, security headers and CSP", async () => {
    const ip = `198.51.100.${counter + 10}`;
    await exhaust(path, method, ip);
    const response = await call(path, {
      method,
      ip,
      origin: ALLOWED,
      requestId: "trace-id-12345678",
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED);
    expect(response.headers.get("Vary") ?? "").toContain("Origin");
    expect(response.headers.get("x-request-id")).toBe("trace-id-12345678");
    expectSecured(response);
    // Status, problem body and rate-limit headers are unchanged.
    expect(response.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(response.headers.get("X-RateLimit-Reset")).toMatch(/^\d+$/);
    const body = await response.json();
    expect(body).toMatchObject({ status: 429, title: "Too Many Requests" });
    expect(framing.findUnique).not.toHaveBeenCalled();
  });

  it("adds no CORS allow-origin for a disallowed origin and generates an id", async () => {
    const ip = `198.51.100.${counter + 100}`;
    await exhaust(path, method, ip);
    const response = await call(path, {
      method,
      ip,
      origin: "https://evil.example.com",
      requestId: "bad id!",
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const id = response.headers.get("x-request-id");
    expect(id).toBeTruthy();
    expect(id).not.toBe("bad id!");
    expectSecured(response);
  });
});

describe("unsupported API version 400", () => {
  it("carries CORS, request id, security headers and CSP", async () => {
    const response = await call("/api/v99/canvases", { origin: ALLOWED });
    expect(response.status).toBe(400);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expectSecured(response);
  });
});
