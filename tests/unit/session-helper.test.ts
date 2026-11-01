import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, nextHeaders } = vi.hoisted(() => ({
  getSession: vi.fn(),
  nextHeaders: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  getAuthServer: () => ({ api: { getSession } }),
}));
vi.mock("next/headers", () => ({ headers: nextHeaders }));

import { getSessionFromHeaders, headersFromNode } from "@/lib/auth/session";
import { auth } from "@/lib/auth";
import { getCachedSession, runWithSessionCache } from "@/lib/api/session-cache";

const betterAuthSession = {
  user: {
    id: "user-1",
    email: "user@example.com",
    name: "User",
    image: null,
    emailVerified: true,
    twoFactorEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  session: {
    id: "session-1",
    token: "raw-session-token",
    userId: "user-1",
    expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    ipAddress: "203.0.113.10",
    userAgent: "vitest",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};

describe("session helper (IMP-041)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the session row on every call so revocation is immediate", async () => {
    getSession.mockResolvedValue(betterAuthSession);
    const headers = new Headers({ cookie: "memoria.session_token=abc.sig" });

    await getSessionFromHeaders(headers);

    expect(getSession).toHaveBeenCalledWith({
      headers,
      query: { disableCookieCache: true, disableRefresh: false },
    });
  });

  it("does not slide the expiry for callers that cannot set a cookie", async () => {
    getSession.mockResolvedValue(betterAuthSession);
    await getSessionFromHeaders(new Headers(), { refresh: false });
    expect(getSession).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { disableCookieCache: true, disableRefresh: true },
      }),
    );
  });

  it("returns only the fields Memoria uses and never the session token", async () => {
    getSession.mockResolvedValue(betterAuthSession);
    const session = await getSessionFromHeaders(new Headers());
    expect(session).toEqual({
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "User",
        image: null,
        emailVerified: true,
        twoFactorEnabled: true,
      },
      session: {
        id: "session-1",
        userId: "user-1",
        expiresAt: new Date("2026-12-01T00:00:00.000Z"),
      },
    });
    expect(JSON.stringify(session)).not.toContain("raw-session-token");
  });

  it("returns null without a session", async () => {
    getSession.mockResolvedValue(null);
    await expect(getSessionFromHeaders(new Headers())).resolves.toBeNull();
  });

  it("serves auth() from the current request headers", async () => {
    const headers = new Headers({ cookie: "memoria.session_token=abc.sig" });
    nextHeaders.mockResolvedValue(headers);
    getSession.mockResolvedValue(betterAuthSession);
    const session = await auth();
    expect(session?.user.id).toBe("user-1");
    expect(getSession).toHaveBeenCalledWith(
      expect.objectContaining({ headers }),
    );
  });

  it("looks the session up once per request", async () => {
    nextHeaders.mockResolvedValue(new Headers());
    getSession.mockResolvedValue(betterAuthSession);
    await runWithSessionCache(async () => {
      await getCachedSession();
      await getCachedSession();
    });
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("copies Node upgrade headers, including repeated ones", () => {
    const headers = headersFromNode({
      cookie: "memoria.session_token=abc.sig",
      "x-memoria-client-ip": "203.0.113.10",
      "x-repeated": ["one", "two"],
      absent: undefined,
    });
    expect(headers.get("cookie")).toBe("memoria.session_token=abc.sig");
    expect(headers.get("x-repeated")).toBe("one, two");
    expect(headers.has("absent")).toBe(false);
  });
});
