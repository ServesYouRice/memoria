import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  askMemoria: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/ai/ask", () => ({ askMemoria: mocks.askMemoria }));

import { POST } from "@/app/api/v1/ai/ask/route";

function request(body: unknown): NextRequest {
  const req = new Request("http://localhost/api/v1/ai/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  (req as any).nextUrl = new URL(req.url);
  return req as unknown as NextRequest;
}

describe("POST /api/v1/ai/ask (IMP-068)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.askMemoria.mockResolvedValue({
      answer: "ok",
      sources: [],
      suggestion: null,
      commandRejected: null,
      retrievedCount: 0,
      usage: {},
    });
  });

  it("requires a session", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await POST(request({ question: "knife site?" }));
    expect(response.status).toBe(401);
    expect(mocks.askMemoria).not.toHaveBeenCalled();
  });

  it("asks for the session user only, whatever the body claims", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-1", email: "a@b.c" } });
    const response = await POST(
      request({ question: "knife site?", userId: "user-2" }),
    );
    expect(response.status).toBe(200);
    expect(mocks.askMemoria).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", question: "knife site?" }),
    );
  });

  it("rejects empty and oversized questions", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-1", email: "a@b.c" } });
    expect((await POST(request({ question: " " }))).status).toBe(400);
    expect((await POST(request({ question: "x".repeat(1_001) }))).status).toBe(
      400,
    );
    expect(mocks.askMemoria).not.toHaveBeenCalled();
  });
});
