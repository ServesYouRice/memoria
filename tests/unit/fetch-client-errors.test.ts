import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, ApiError } from "@/lib/api/fetch-client";

describe("apiFetch problem metadata", () => {
  afterEach(() => vi.restoreAllMocks());

  it("preserves request and retry metadata for 429 responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "https://memoria.local/errors/rate-limit-exceeded",
          detail: "Try again later",
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/problem+json",
            "retry-after": "17",
            "x-request-id": "request-1",
          },
        },
      ),
    );
    const error = await apiFetch("/api/v1/search").catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 429,
      retryAfterSeconds: 17,
      requestId: "request-1",
      problemType: "https://memoria.local/errors/rate-limit-exceeded",
    });
  });

  it("handles malformed non-JSON proxy failures safely", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("upstream unavailable", { status: 502 }),
    );
    await expect(apiFetch("/api/v1/search")).rejects.toMatchObject({
      status: 502,
      message: "Request failed with status 502",
    });
  });
});
