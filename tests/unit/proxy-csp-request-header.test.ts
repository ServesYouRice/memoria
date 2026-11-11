/**
 * TASK-227 — the proxy forwards the same Content-Security-Policy it sends,
 * nonce included, as a request header, which is where the Next.js App Router
 * reads the nonce for its own script tags.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const dbMocks = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: { canvasEmbed: { findUnique: dbMocks.findUnique } },
}));

import { createEmbedToken } from "@/lib/embeds/token";
import { proxy } from "@/proxy";

/** A request header NextResponse.next({ request: { headers } }) forwards. */
function forwardedRequestHeader(response: Response, name: string) {
  const overridden = (
    response.headers.get("x-middleware-override-headers") ?? ""
  )
    .split(",")
    .map((header) => header.trim().toLowerCase());
  if (!overridden.includes(name.toLowerCase())) return null;
  return response.headers.get(`x-middleware-request-${name.toLowerCase()}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("proxy forwards the CSP to the app", () => {
  it("sets a request CSP identical to the response CSP with the request nonce", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3000/dashboard"),
    );
    const responseCsp = response.headers.get("Content-Security-Policy");
    const nonce = forwardedRequestHeader(response, "x-nonce");
    expect(nonce).toBeTruthy();
    const requestCsp = forwardedRequestHeader(
      response,
      "content-security-policy",
    );
    expect(requestCsp).toBe(responseCsp);
    expect(requestCsp).toContain(`'nonce-${nonce}'`);
  });

  it("forwards the embed frame-ancestors too", async () => {
    dbMocks.findUnique.mockResolvedValue({
      id: "embed-1",
      canvasId: "canvas-1",
      allowedOrigins: ["https://blog.example.com"],
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    });
    const { token } = createEmbedToken();
    const response = await proxy(
      new NextRequest(`http://localhost:3000/embed/${token}`),
    );
    const requestCsp = forwardedRequestHeader(
      response,
      "content-security-policy",
    );
    expect(requestCsp).toContain("frame-ancestors https://blog.example.com");
    expect(requestCsp).toBe(response.headers.get("Content-Security-Policy"));
  });
});
