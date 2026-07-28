import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

describe("Search API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("should return 400 when query is too short", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });

    const { GET } = await import("@/app/api/v1/search/route");

    const response = await GET(
      new Request("http://localhost/api/v1/search?q=a"),
    );
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.title).toBe("Bad Request");
  });

  it("should query and return results for valid search", async () => {
    const { auth } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");

    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });

    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ exists: false }])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ value: "NOTE", count: 1 }])
      .mockResolvedValueOnce([{ value: "tag", count: 1 }])
      .mockResolvedValueOnce([
        {
          id: "item-1",
          canvasId: "canvas-1",
          type: "NOTE",
          content: { text: "Hello world" },
          tags: ["tag"],
          createdAt: new Date("2024-01-01T00:00:00Z"),
          updatedAt: new Date("2024-01-02T00:00:00Z"),
          canvasName: "Canvas 1",
        },
      ]);

    const { GET } = await import("@/app/api/v1/search/route");

    const response = await GET(
      new Request("http://localhost/api/v1/search?q=hello"),
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.totalResults).toBe(1);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].snippet).toContain("Hello world");
    expect(body.facets.types).toEqual([{ value: "NOTE", count: 1 }]);
  });
});
