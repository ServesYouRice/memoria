// @vitest-environment node
import http from "http";
import type { AddressInfo } from "net";
import type * as DnsModule from "dns";
import type * as HttpModule from "http";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Resolve the test host to a public address so the production SSRF checks
// run unchanged, then point the pinned socket at the local drip server.
const { lookupMock, target } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
  target: { port: 0 },
}));

vi.mock("dns", async (importOriginal) => {
  const actual = await importOriginal<typeof DnsModule>();
  return { ...actual, promises: { ...actual.promises, lookup: lookupMock } };
});

vi.mock("http", async (importOriginal) => {
  const actual = await importOriginal<typeof HttpModule>();
  const request = ((options: HttpModule.RequestOptions, callback?: never) =>
    actual.request(
      {
        ...options,
        hostname: "127.0.0.1",
        port: target.port,
        lookup: undefined,
      },
      callback,
    )) as typeof actual.request;
  return { ...actual, request, default: { ...actual, request } };
});

import { safeFetchBuffer } from "@/lib/utils/ssrf-protection";
import { deliverSignedWebhook } from "@/lib/agents/webhooks";

let server: http.Server;
const timers = new Set<NodeJS.Timeout>();

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/drip" });
      res.end();
      return;
    }
    // One byte every 50 ms: never idle for the 200 ms socket timeout.
    res.writeHead(200, { "content-type": "text/plain" });
    const timer = setInterval(() => res.write("x"), 50);
    timers.add(timer);
    res.on("close", () => {
      clearInterval(timer);
      timers.delete(timer);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  target.port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const timer of timers) clearInterval(timer);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

const url = (path: string) => `http://drip.example:${target.port}${path}`;

describe("safeFetchBuffer total deadline (VAL-277)", () => {
  it("stops a dripping response at the deadline with 408", async () => {
    const started = Date.now();
    const result = await safeFetchBuffer(url("/drip"), {
      timeout: 200,
      deadlineMs: 300,
    });
    const elapsed = Date.now() - started;
    expect(result).toMatchObject({ ok: false, status: 408 });
    expect(elapsed).toBeLessThan(1_000);
  });

  it("bounds the whole redirect chain, not each hop", async () => {
    const started = Date.now();
    const result = await safeFetchBuffer(url("/redirect"), {
      timeout: 200,
      deadlineMs: 300,
    });
    expect(result).toMatchObject({ ok: false, status: 408 });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("has a default deadline when none is given", async () => {
    const started = Date.now();
    const result = await safeFetchBuffer(url("/drip"), {
      timeout: 100,
      maxRedirects: 2,
    });
    expect(result).toMatchObject({ ok: false, status: 408 });
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it("races a slow DNS lookup", async () => {
    lookupMock.mockImplementation(() => new Promise(() => {}));
    const started = Date.now();
    const result = await safeFetchBuffer(url("/drip"), {
      timeout: 200,
      deadlineMs: 300,
    });
    expect(result).toMatchObject({ ok: false, status: 408 });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("keeps the caller abort as 499", async () => {
    const result = await safeFetchBuffer(url("/drip"), {
      timeout: 200,
      deadlineMs: 5_000,
      signal: AbortSignal.timeout(150),
    });
    expect(result).toMatchObject({ ok: false, status: 499 });
  });
});

describe("deliverSignedWebhook timeout (VAL-278)", () => {
  it("aborts a dripping delivery at timeoutMs", async () => {
    const started = Date.now();
    await expect(
      deliverSignedWebhook({
        url: url("/redirect"),
        secret: "s3cret",
        body: { hello: "world" },
        timeoutMs: 300,
      }),
    ).rejects.toThrow(
      expect.objectContaining({ detail: "Webhook delivery timed out." }),
    );
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
