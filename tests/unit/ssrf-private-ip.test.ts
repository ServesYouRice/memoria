import type * as DnsModule from "dns";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isPrivateIp,
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
});

describe("isPrivateIp special-purpose ranges", () => {
  it.each([
    // VAL-275: unspecified in every form, IPv4-compatible ::/96.
    "::",
    "0:0:0:0:0:0:0:0",
    "0::0",
    "::0",
    "::127.0.0.1",
    "::7f00:1",
    // VAL-276
    "100.64.0.1",
    "100.100.100.200",
    "100.127.255.255",
    "192.0.0.1",
    "198.18.0.1",
    "198.19.255.255",
    "fec0::1",
    "FEC0::1",
    "ff02::1",
    "64:ff9b::7f00:1",
    "64:ff9b::127.0.0.1",
    "64:ff9b::a9fe:a9fe",
    "2002:7f00:1::",
    "2002:a00:1::1",
    // Still blocked.
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "0.0.0.0",
    "::1",
    "0:0:0:0:0:0:0:1",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "fe80::1%eth0",
    "not-an-ip",
  ])("blocks %s", (address) => {
    expect(isPrivateIp(address)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "100.63.255.255",
    "100.128.0.1",
    "192.0.1.1",
    "198.20.0.1",
    "198.17.255.255",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "64:ff9b::808:808",
    "2002:808:808::",
    "::ffff:8.8.8.8",
  ])("allows public %s", (address) => {
    expect(isPrivateIp(address)).toBe(false);
  });
});

describe("URL validation with the unspecified IPv6 address (VAL-275)", () => {
  it("rejects http://[::]/ with and without DNS", async () => {
    expect(validateUrlForSsrf("http://[::]/").valid).toBe(false);
    expect((await validateUrlForSsrfWithDns("http://[::]/")).valid).toBe(false);
  });

  it("rejects a hostname that resolves to ::", async () => {
    lookupMock.mockResolvedValue([{ address: "::", family: 6 }]);
    const result = await validateUrlForSsrfWithDns("https://evil.example/");
    expect(result.valid).toBe(false);
    expect(result.pinnedIp).toBeUndefined();
  });
});
