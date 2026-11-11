import { EventEmitter } from "events";
import type * as DnsModule from "dns";
import type * as HttpsModule from "https";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock, requestMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
  requestMock: vi.fn(),
}));

vi.mock("dns", async (importOriginal) => {
  const actual = await importOriginal<typeof DnsModule>();
  return { ...actual, promises: { ...actual.promises, lookup: lookupMock } };
});

vi.mock("https", async (importOriginal) => {
  const actual = await importOriginal<typeof HttpsModule>();
  return {
    ...actual,
    request: requestMock,
    default: { ...actual.default, request: requestMock },
  };
});

import { fetchLinkPage } from "@/lib/services/link-page";
import { safeFetchBuffer } from "@/lib/utils/ssrf-protection";

const PAGE = `<!doctype html><html><head>
<title>Final page</title>
<link rel="icon" href="icon.png">
<meta property="og:image" content="../img/cover.jpg">
<link rel="canonical" href="./page">
</head><body>hi</body></html>`;

/** Answers by Host header: a.example redirects twice, b.example serves. */
function routes(options: { headers: Record<string, string>; path: string }) {
  const key = `${options.headers.Host}${options.path}`;
  if (key === "a.example/x")
    return { status: 301, headers: { location: "https://a.example/y" } };
  if (key === "a.example/y")
    return {
      status: 302,
      headers: { location: "https://b.example/dir/page" },
    };
  return {
    status: 200,
    headers: { "content-type": "text/html" },
    body: Buffer.from(PAGE),
  };
}

beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  requestMock.mockReset();
  requestMock.mockImplementation(
    (
      options: { headers: Record<string, string>; path: string },
      callback: (res: EventEmitter) => void,
    ) => {
      const spec = routes(options) as {
        status: number;
        headers: Record<string, string>;
        body?: Buffer;
      };
      const res = Object.assign(new EventEmitter(), {
        statusCode: spec.status,
        headers: spec.headers,
      });
      const req = Object.assign(new EventEmitter(), {
        end: vi.fn(),
        write: vi.fn(),
        destroy: vi.fn(),
      });
      process.nextTick(() => {
        callback(res);
        process.nextTick(() => {
          if (spec.body) res.emit("data", spec.body);
          res.emit("end");
        });
      });
      return req;
    },
  );
});

describe("redirected link pages (VAL-295)", () => {
  it("reports the URL of the response it read", async () => {
    const result = await safeFetchBuffer("https://a.example/x");
    expect(result).toMatchObject({
      ok: true,
      finalUrl: "https://b.example/dir/page",
    });
    expect(requestMock).toHaveBeenCalledTimes(3);
    expect(lookupMock).toHaveBeenCalledTimes(3);
  });

  it("resolves relative metadata against the final URL", async () => {
    const page = await fetchLinkPage("https://a.example/x");
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.metadata).toMatchObject({
      favicon: "https://b.example/dir/icon.png",
      image: "https://b.example/img/cover.jpg",
      url: "https://b.example/dir/page",
    });
  });
});
