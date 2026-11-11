import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  setCachedUnfurl: vi.fn(),
}));

vi.mock("@/lib/utils/ssrf-protection", () => ({ safeFetch: mocks.safeFetch }));
vi.mock("@/lib/cache/unfurl-cache", () => ({
  getCachedUnfurl: vi.fn(async () => null),
  setCachedUnfurl: mocks.setCachedUnfurl,
}));
vi.mock("@/lib/api/route-handler", async () => {
  const { errorResponse } = await import("@/lib/errors");
  return {
    withAuthValidation:
      (
        schema: { parse: (value: unknown) => unknown },
        handler: (data: unknown, request: Request) => Promise<Response>,
      ) =>
      async (request: Request) => {
        try {
          return await handler(schema.parse(await request.json()), request);
        } catch (error) {
          return errorResponse(error, request.url);
        }
      },
  };
});

import { POST } from "@/app/api/v1/unfurl/route";

function unfurl() {
  return (POST as unknown as (request: Request) => Promise<Response>)(
    new Request("http://localhost/api/v1/unfurl", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/page" }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.FEATURE_BOOKMARK_UNFURLING;
});

describe("POST /api/v1/unfurl failure statuses", () => {
  it.each([401, 403, 404, 429, 500, 503, 304, 999])(
    "answers 502 with upstreamStatus when the site answers %i",
    async (status) => {
      mocks.safeFetch.mockResolvedValue({
        ok: false,
        status,
        error: `HTTP ${status}`,
      });

      const response = await unfurl();

      expect(response.status).toBe(502);
      expect(response.headers.get("content-type")).toContain(
        "application/problem+json",
      );
      const body = await response.json();
      expect(body).toMatchObject({
        status: 502,
        title: "Unfurl Failed",
        upstreamStatus: status,
      });
      expect(mocks.setCachedUnfurl).not.toHaveBeenCalled();
    },
  );

  it("answers 502 for a redirect without a Location header", async () => {
    mocks.safeFetch.mockResolvedValue({
      ok: false,
      status: 302,
      error: "Redirect without location header",
    });

    const response = await unfurl();

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ upstreamStatus: 302 });
  });

  it.each([
    [400, "URL resolves to a private address"],
    [408, "Request timeout"],
    [413, "Response too large"],
    [500, "socket hang up"],
  ])("keeps the local failure status %i", async (status, error) => {
    mocks.safeFetch.mockResolvedValue({ ok: false, status, error });

    const response = await unfurl();

    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body).toMatchObject({ status, detail: error });
    expect(body).not.toHaveProperty("upstreamStatus");
  });

  it("never answers with a local status outside 400-599", async () => {
    mocks.safeFetch.mockResolvedValue({
      ok: false,
      status: 310,
      error: "Too many redirects",
    });

    const response = await unfurl();

    expect(response.status).toBe(502);
  });

  it("keeps the feature-disabled 403", async () => {
    process.env.FEATURE_BOOKMARK_UNFURLING = "false";

    const response = await unfurl();

    expect(response.status).toBe(403);
    expect(mocks.safeFetch).not.toHaveBeenCalled();
  });
});
