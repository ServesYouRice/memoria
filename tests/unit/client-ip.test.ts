import { describe, expect, it } from "vitest";
import { deriveClientIp } from "@/lib/network/client-ip";

describe("deriveClientIp", () => {
  it("uses the socket peer for direct traffic and ignores spoofing", () => {
    expect(deriveClientIp("203.0.113.8", "198.51.100.9", undefined)).toBe(
      "203.0.113.8",
    );
  });

  it("uses the forwarded client behind one trusted proxy", () => {
    expect(deriveClientIp("10.0.0.2", "203.0.113.8", "10.0.0.0/8")).toBe(
      "203.0.113.8",
    );
  });

  it("selects the rightmost untrusted address through multiple proxies", () => {
    expect(
      deriveClientIp(
        "10.0.0.2",
        "198.51.100.7, 172.16.0.4, 10.0.0.3",
        "10.0.0.0/8,172.16.0.0/12",
      ),
    ).toBe("198.51.100.7");
  });

  it("fails safely when a trusted proxy sends a malformed chain", () => {
    expect(
      deriveClientIp("10.0.0.2", "spoofed, 203.0.113.8", "10.0.0.0/8"),
    ).toBe("10.0.0.2");
  });

  it("normalizes IPv4-mapped peers", () => {
    expect(deriveClientIp("::ffff:203.0.113.8", undefined, undefined)).toBe(
      "203.0.113.8",
    );
  });

  it("supports IPv6 proxy CIDRs and chains", () => {
    expect(
      deriveClientIp("2001:db8:1::2", "2001:db8:2::5", "2001:db8:1::/48"),
    ).toBe("2001:db8:2::5");
  });

  it("rejects invalid trusted proxy configuration", () => {
    expect(() =>
      deriveClientIp("10.0.0.2", "203.0.113.8", "10.0.0.0/99"),
    ).toThrow("Invalid trusted proxy CIDR");
  });
});
