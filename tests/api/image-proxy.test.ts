import { EventEmitter } from "events";
import type * as DnsModule from "dns";
import type * as HttpsModule from "https";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The proxy must reuse the unfurl SSRF stack (pinned DNS, private-address
// rejection, per-redirect revalidation), so the suite stubs only the
// transport underneath it: dns.lookup and https.request.
const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  request: vi.fn(),
  auth: vi.fn(),
  redisStore: new Map<string, Buffer>(),
  redisEnabled: { value: false },
}));

vi.mock("dns", async (importOriginal) => {
  const actual = await importOriginal<typeof DnsModule>();
  return { ...actual, promises: { ...actual.promises, lookup: mocks.lookup } };
});

vi.mock("https", async (importOriginal) => {
  const actual = await importOriginal<typeof HttpsModule>();
  return {
    ...actual,
    request: mocks.request,
    default: { ...actual.default, request: mocks.request },
  };
});

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));

vi.mock("@/lib/api/route-handler", async () => {
  const { errorResponse } = await import("@/lib/errors");
  return {
    withApiHandler:
      (handler: (request: Request) => Promise<Response>) =>
      async (request: Request) => {
        try {
          return await handler(request);
        } catch (error) {
          return errorResponse(error, request.url);
        }
      },
  };
});

vi.mock("@/lib/cache/redis-client", () => ({
  getRedisClient: () =>
    mocks.redisEnabled.value
      ? {
          getBuffer: async (key: string) => mocks.redisStore.get(key) ?? null,
          setex: async (key: string, _ttl: number, value: Buffer) => {
            mocks.redisStore.set(key, value);
            return "OK";
          },
        }
      : null,
}));

import { GET } from "@/app/api/v1/image-proxy/route";
import { signImageProxyUrl } from "@/lib/images/signed-proxy";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(24, 1),
]);
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);
const HTML = Buffer.from("<!doctype html><html><body>hi</body></html>");

const PUBLIC_IP = "93.184.216.34";

interface StubResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: Buffer;
}

/** A ClientRequest stub replying with each response in turn. */
function respondWith(...responses: StubResponse[]) {
  let call = 0;
  return (_options: unknown, callback: (res: EventEmitter) => void) => {
    const spec = responses[Math.min(call++, responses.length - 1)]!;
    const res = new EventEmitter() as EventEmitter & {
      statusCode: number;
      headers: Record<string, string>;
    };
    res.statusCode = spec.status ?? 200;
    res.headers = spec.headers ?? {};

    const req = new EventEmitter() as EventEmitter & Record<string, unknown>;
    req["end"] = vi.fn();
    req["write"] = vi.fn();
    req["destroy"] = vi.fn();

    process.nextTick(() => {
      callback(res);
      process.nextTick(() => {
        if (spec.body) res.emit("data", spec.body);
        res.emit("end");
      });
    });
    return req;
  };
}

function proxyRequest(
  url: string,
  extra: Record<string, string> = {},
  headers: Record<string, string> = {},
) {
  const params = new URLSearchParams({ url, ...extra });
  return new Request(`http://localhost:3000/api/v1/image-proxy?${params}`, {
    headers,
  }) as never;
}

describe("image proxy route (IMP-057)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redisStore.clear();
    mocks.redisEnabled.value = false;
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.lookup.mockResolvedValue([{ address: PUBLIC_IP, family: 4 }]);
    mocks.request.mockImplementation(
      respondWith({ headers: { "content-type": "image/png" }, body: PNG }),
    );
  });

  it("requires a session when no signature is present", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await GET(proxyRequest("https://example.com/a.png"));

    expect(response.status).toBe(401);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("serves a remote image to a signed-in user with cache headers", async () => {
    const response = await GET(proxyRequest("https://example.com/a.png"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toMatch(/max-age=86400/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("etag")).toMatch(/^"[A-Za-z0-9_-]+"$/);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);

    // The connection is pinned to the validated address.
    const [options] = mocks.request.mock.calls[0]!;
    expect(options).toMatchObject({
      hostname: PUBLIC_IP,
      headers: expect.objectContaining({ Host: "example.com" }),
    });
  });

  it("accepts a server-issued signature in place of a session", async () => {
    mocks.auth.mockResolvedValue(null);
    const url = "https://example.com/favicon.png";

    const response = await GET(
      proxyRequest(url, { sig: signImageProxyUrl(url) }),
    );

    expect(response.status).toBe(200);
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("rejects a signature for a different URL", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await GET(
      proxyRequest("https://evil.example/x.png", {
        sig: signImageProxyUrl("https://example.com/favicon.png"),
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each(["javascript:alert(1)", "ftp://example.com/a.png", "/api/v1/x"])(
    "rejects the non-HTTP URL %s",
    async (url) => {
      const response = await GET(proxyRequest(url));
      expect(response.status).toBe(400);
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );

  it.each([
    "http://127.0.0.1/a.png",
    "http://169.254.169.254/latest/meta-data",
    "http://localhost:3000/a.png",
    "http://[::1]/a.png",
  ])("blocks the private address %s", async (url) => {
    const response = await GET(proxyRequest(url));
    expect(response.status).toBe(400);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("blocks a hostname that resolves to a private address", async () => {
    mocks.lookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);

    const response = await GET(proxyRequest("https://internal.example/a.png"));

    expect(response.status).toBe(400);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("revalidates redirect targets", async () => {
    mocks.request.mockImplementation(
      respondWith({
        status: 302,
        headers: { location: "http://127.0.0.1/admin.png" },
      }),
    );

    const response = await GET(proxyRequest("https://example.com/a.png"));

    expect(response.status).toBe(400);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it("rejects SVG even when labelled as an image", async () => {
    mocks.request.mockImplementation(
      respondWith({ headers: { "content-type": "image/svg+xml" }, body: SVG }),
    );

    const response = await GET(proxyRequest("https://example.com/a.svg"));

    expect(response.status).toBe(415);
  });

  it("rejects HTML that claims to be a PNG", async () => {
    mocks.request.mockImplementation(
      respondWith({ headers: { "content-type": "image/png" }, body: HTML }),
    );

    const response = await GET(proxyRequest("https://example.com/a.png"));

    expect(response.status).toBe(415);
  });

  it("caps the response size", async () => {
    mocks.request.mockImplementation(
      respondWith({
        headers: {
          "content-type": "image/png",
          "content-length": String(64 * 1024 * 1024),
        },
        body: PNG,
      }),
    );

    const response = await GET(proxyRequest("https://example.com/huge.png"));

    expect(response.status).toBe(413);
  });

  it("maps upstream failures to a bad gateway", async () => {
    mocks.request.mockImplementation(respondWith({ status: 500 }));

    const response = await GET(proxyRequest("https://example.com/a.png"));

    expect(response.status).toBe(502);
  });

  it("serves repeat requests from the Redis cache", async () => {
    mocks.redisEnabled.value = true;
    const url = "https://example.com/cached.png";

    const first = await GET(proxyRequest(url));
    const second = await GET(proxyRequest(url));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await second.arrayBuffer())).toEqual(PNG);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it("answers a matching If-None-Match with 304", async () => {
    const url = "https://example.com/a.png";
    const first = await GET(proxyRequest(url));
    const etag = first.headers.get("etag")!;

    const second = await GET(proxyRequest(url, {}, { "if-none-match": etag }));

    expect(second.status).toBe(304);
    expect(second.headers.get("etag")).toBe(etag);
  });
});
