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

  it("returns the peer for an untrusted peer or a malformed chain", () => {
    expect(deriveClientIp("8.8.8.8", "203.0.113.5", cidrs)).toBe("8.8.8.8");
    expect(deriveClientIp("10.0.0.2", "garbage, 203.0.113.5", cidrs)).toBe(
      "10.0.0.2",
    );
  });
});
