import net from "net";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as clientIp from "./client-ip";

const { deriveClientIp } = clientIp;

async function loadEnvWith(value: string) {
  vi.resetModules();
  vi.stubEnv("TRUSTED_PROXY_CIDRS", value);
  return import("@/lib/env");
}

describe("TRUSTED_PROXY_CIDRS parsing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("accepts comma-separated IPv4/IPv6 CIDRs and bare addresses", () => {
    expect(typeof clientIp.parseTrustedProxyCidrs).toBe("function");
    expect(() =>
      clientIp.parseTrustedProxyCidrs("10.0.0.0/8, ::1, 192.168.1.10"),
    ).not.toThrow();
  });

  it.each(["10.0.0.0/33", "proxy.internal", "10.0.0.0/8;10.1.0.0/16"])(
    "rejects %s naming the bad entry",
    (value) => {
      expect(typeof clientIp.parseTrustedProxyCidrs).toBe("function");
      expect(() => clientIp.parseTrustedProxyCidrs(value)).toThrow(value);
    },
  );

  it.each(["10.0.0.0/33", "proxy.internal", "10.0.0.0/8;10.1.0.0/16"])(
    "fails environment validation for %s",
    async (value) => {
      const errors: string[] = [];
      vi.spyOn(console, "error").mockImplementation((...args) => {
        errors.push(args.join(" "));
      });
      await expect(loadEnvWith(value)).rejects.toThrow(
        "Invalid environment variables",
      );
      expect(errors.join("\n")).toContain(value);
    },
  );

  it("accepts a valid list in environment validation", async () => {
    const { env } = await loadEnvWith("10.0.0.0/8, ::1, 192.168.1.10");
    expect(env.TRUSTED_PROXY_CIDRS).toBe("10.0.0.0/8, ::1, 192.168.1.10");
  });

  it("does not re-parse an unchanged list on every call", () => {
    const spy = vi.spyOn(net.BlockList.prototype, "addSubnet");
    const cidrs = "10.0.0.0/8, 172.16.0.0/12";
    deriveClientIp("10.0.0.1", "203.0.113.5", cidrs);
    const afterFirst = spy.mock.calls.length;
    for (let index = 0; index < 5; index += 1) {
      expect(deriveClientIp("10.0.0.1", "203.0.113.5", cidrs)).toBe(
        "203.0.113.5",
      );
    }
    expect(spy.mock.calls.length).toBe(afterFirst);
  });
});

describe("deriveClientIp", () => {
  const cidrs = "10.0.0.0/8, ::1, 192.168.1.10";

  it("returns the peer when no proxies are trusted", () => {
    expect(deriveClientIp("10.0.0.1", "203.0.113.5", undefined)).toBe(
      "10.0.0.1",
    );
    expect(deriveClientIp("10.0.0.1", "203.0.113.5", "   ")).toBe("10.0.0.1");
  });

  it("walks X-Forwarded-For through trusted proxies", () => {
    expect(
      deriveClientIp("::ffff:10.0.0.2", "203.0.113.5, 10.1.1.1", cidrs),
    ).toBe("203.0.113.5");
    expect(deriveClientIp("::1", "198.51.100.7", cidrs)).toBe("198.51.100.7");
  });

  it("returns the peer for an untrusted peer or a malformed boundary hop", () => {
    expect(deriveClientIp("8.8.8.8", "203.0.113.5", cidrs)).toBe("8.8.8.8");
    expect(deriveClientIp("8.8.8.8", "x, 10.1.1.1", cidrs)).toBe("8.8.8.8");
    // The right-most untrusted entry itself is not an IP (Q-003 fallback).
    expect(deriveClientIp("10.0.0.2", "203.0.113.5, garbage", cidrs)).toBe(
      "10.0.0.2",
    );
    expect(deriveClientIp("10.0.0.2", "unknown, 10.1.1.1", cidrs)).toBe(
      "10.0.0.2",
    );
    expect(deriveClientIp("10.0.0.2", "", cidrs)).toBe("10.0.0.2");
  });

  it("ignores client-supplied junk left of the trust boundary", () => {
    expect(deriveClientIp("10.0.0.2", "x, 203.0.113.5", cidrs)).toBe(
      "203.0.113.5",
    );
    expect(
      deriveClientIp("10.0.0.2", "garbage, unknown, 203.0.113.5", cidrs),
    ).toBe("203.0.113.5");
    expect(
      deriveClientIp("10.0.0.2", ["x", "203.0.113.5, 10.1.1.1"], cidrs),
    ).toBe("203.0.113.5");
  });

  it("accepts addresses with ports", () => {
    expect(deriveClientIp("10.0.0.2", "203.0.113.5:5678", cidrs)).toBe(
      "203.0.113.5",
    );
    expect(
      deriveClientIp("10.0.0.2", "198.51.100.7, 10.1.1.1:443", cidrs),
    ).toBe("198.51.100.7");
    expect(deriveClientIp("10.0.0.2", "[2001:db8::1]:8443", cidrs)).toBe(
      "2001:db8::1",
    );
  });

  it("walks multi-hop trusted chains to the first untrusted hop", () => {
    expect(
      deriveClientIp(
        "10.0.0.2",
        "198.51.100.1, 203.0.113.5, 192.168.1.10, 10.2.2.2",
        cidrs,
      ),
    ).toBe("203.0.113.5");
    // Every hop trusted: the left-most one is the best we know.
    expect(deriveClientIp("10.0.0.2", "10.3.3.3, 10.2.2.2", cidrs)).toBe(
      "10.3.3.3",
    );
  });

  it("does not accept a port in trusted proxy CIDRs", () => {
    expect(() => clientIp.parseTrustedProxyCidrs("10.0.0.1:80")).toThrow(
      "10.0.0.1:80",
    );
  });
});
