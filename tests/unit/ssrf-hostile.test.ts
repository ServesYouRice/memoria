import { EventEmitter } from "events";
import type * as DnsModule from "dns";
import type * as HttpsModule from "https";
import { describe, expect, it, vi } from "vitest";
import { safeFetch, validateUrlForSsrf } from "@/lib/utils/ssrf-protection";

// IMP-043 moved safeFetch off globalThis.fetch and onto pinnedHttpRequest,
// which issues the request through node's https module against a pinned
// address. Spying on fetch — or on the module's own pinnedHttpRequest export,
// which safeFetch calls through a local binding — intercepts nothing, so the
// suite reached the real network and asserted nothing about revalidation.
// Stubbing the transport is what makes this hermetic.
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

/** A ClientRequest stub that replies once with the given status and headers. */
function respondWith(status: number, headers: Record<string, string>) {
  return (_options: unknown, callback: (res: EventEmitter) => void) => {
    const res = new EventEmitter() as EventEmitter & {
      statusCode: number;
      headers: Record<string, string>;
    };
    res.statusCode = status;
    res.headers = headers;

    const req = new EventEmitter() as EventEmitter & Record<string, unknown>;
    req["end"] = vi.fn();
    req["write"] = vi.fn();
    req["destroy"] = vi.fn();
    req["setTimeout"] = vi.fn();

    process.nextTick(() => {
      callback(res);
      process.nextTick(() => res.emit("end"));
    });

    return req;
  };
}

describe("hostile SSRF inputs", () => {
  it.each([
    "http://2130706433/",
    "http://0177.0.0.1/",
    "http://0x7f000001/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::1]/",
  ])("blocks alternate local address %s", (url) => {
    expect(validateUrlForSsrf(url).valid).toBe(false);
  });

  it("revalidates redirect targets before fetching them", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    requestMock.mockImplementation(
      respondWith(302, { location: "http://127.0.0.1/admin" }),
    );

    const result = await safeFetch("https://example.com");

    // The redirect points at loopback, so the second pass through validation
    // rejects it rather than following it.
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});
