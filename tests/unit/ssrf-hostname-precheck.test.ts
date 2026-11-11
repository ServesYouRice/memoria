import type * as DnsModule from "dns";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  validateUrlForSsrf,
  validateUrlForSsrfWithDns,
} from "@/lib/utils/ssrf-protection";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));

vi.mock("dns", async (importOriginal) => {
  const actual = await importOriginal<typeof DnsModule>();
  return { ...actual, promises: { ...actual.promises, lookup: lookupMock } };
});

beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

describe("SSRF hostname pre-check (VAL-294)", () => {
  it.each([
    "fda.gov",
    "fcc.gov",
    "fdroid.org",
    "fc2.com",
    "fdic.gov",
    "10.com",
    "127.example.org",
    "192.168.example.com",
  ])("lets the public name %s through to the DNS check", async (host) => {
    expect(validateUrlForSsrf(`https://${host}/`)).toEqual({ valid: true });
    const pinned = await validateUrlForSsrfWithDns(`https://${host}/`);
    expect(pinned).toMatchObject({ valid: true, pinnedIp: "93.184.216.34" });
  });

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "127.1",
    "0x7f.0.0.1",
    "[::1]",
    "[fd00::1]",
    "[fe80::1]",
    "[::ffff:127.0.0.1]",
    "localhost",
    "LOCALHOST",
    "0.0.0.0",
  ])("still rejects %s", async (host) => {
    expect(validateUrlForSsrf(`http://${host}/`).valid).toBe(false);
    expect((await validateUrlForSsrfWithDns(`http://${host}/`)).valid).toBe(
      false,
    );
  });

  it("rejects a public-looking name that resolves to a private address", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.1", family: 4 }]);
    expect(validateUrlForSsrf("https://fda.gov/").valid).toBe(true);
    expect(await validateUrlForSsrfWithDns("https://fda.gov/")).toMatchObject({
      valid: false,
      error: "Resolved to a private address",
    });
  });
});
