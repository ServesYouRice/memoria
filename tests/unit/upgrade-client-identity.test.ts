/**
 * TASK-170 (option c): the app server derives the client address with its
 * trusted-proxy rules and passes it to the realtime process in a header
 * signed with COLLABORATION_PROXY_SECRET. Only a verified header sets the
 * identity; anything else falls back to the direct derivation.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  UPGRADE_CLIENT_IP_HEADER,
  deriveUpgradeClientId,
  signUpgradeClientIp,
} from "@/lib/collaboration/upgrade-policy";

const SECRET = "s".repeat(40);

function proxied(header: string | undefined, forwardedFor?: string) {
  return {
    socket: { remoteAddress: "127.0.0.1" },
    headers: {
      ...(header ? { [UPGRADE_CLIENT_IP_HEADER]: header } : {}),
      ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
    },
  } as never;
}

afterEach(() => vi.unstubAllEnvs());

describe("upgrade client identity through the app server's proxy", () => {
  it("gives two proxied browsers different identities", () => {
    vi.stubEnv("COLLABORATION_PROXY_SECRET", SECRET);
    vi.stubEnv("TRUSTED_PROXY_CIDRS", "");
    const a = deriveUpgradeClientId(
      proxied(signUpgradeClientIp("203.0.113.5", SECRET), "203.0.113.5"),
    );
    const b = deriveUpgradeClientId(
      proxied(signUpgradeClientIp("198.51.100.7", SECRET), "198.51.100.7"),
    );
    expect(a).toBe("203.0.113.5");
    expect(b).toBe("198.51.100.7");
  });

  it("ignores a forged or stale identity header", () => {
    vi.stubEnv("COLLABORATION_PROXY_SECRET", SECRET);
    vi.stubEnv("TRUSTED_PROXY_CIDRS", "");
    const forged = signUpgradeClientIp("10.9.9.9", "x".repeat(40));
    expect(deriveUpgradeClientId(proxied(forged))).toBe("127.0.0.1");
    expect(deriveUpgradeClientId(proxied("1.2.3.4"))).toBe("127.0.0.1");
    const stale = signUpgradeClientIp(
      "10.9.9.9",
      SECRET,
      Date.now() - 10 * 60_000,
    );
    expect(deriveUpgradeClientId(proxied(stale))).toBe("127.0.0.1");
  });

  it("ignores the header on a direct connection when no secret is set", () => {
    vi.stubEnv("COLLABORATION_PROXY_SECRET", "");
    vi.stubEnv("TRUSTED_PROXY_CIDRS", "");
    const header = signUpgradeClientIp("10.9.9.9", "");
    const request = {
      socket: { remoteAddress: "203.0.113.9" },
      headers: { [UPGRADE_CLIENT_IP_HEADER]: header },
    } as never;
    expect(deriveUpgradeClientId(request)).toBe("203.0.113.9");
  });

  it("keeps the trusted-gateway path unchanged", () => {
    vi.stubEnv("COLLABORATION_PROXY_SECRET", SECRET);
    vi.stubEnv("TRUSTED_PROXY_CIDRS", "172.29.47.0/28");
    const request = {
      socket: { remoteAddress: "172.29.47.2" },
      headers: { "x-forwarded-for": "198.51.100.20" },
    } as never;
    expect(deriveUpgradeClientId(request)).toBe("198.51.100.20");
  });
});

describe("stamping on the app server", () => {
  it("replaces a caller-supplied header with a signed, verifiable one", async () => {
    const { stampUpgradeClientIp } =
      await import("@/lib/collaboration/upgrade-policy");
    vi.stubEnv("COLLABORATION_PROXY_SECRET", SECRET);
    vi.stubEnv("TRUSTED_PROXY_CIDRS", "");
    const request = {
      socket: { remoteAddress: "203.0.113.50" },
      headers: {
        [UPGRADE_CLIENT_IP_HEADER]: "spoofed",
        "x-forwarded-for": "10.0.0.1",
      } as Record<string, string>,
      rawHeaders: [
        "X-Memoria-Upgrade-Client-Ip",
        "spoofed",
        "X-Forwarded-For",
        "10.0.0.1",
      ],
    };
    stampUpgradeClientIp(request as never, SECRET);
    const copies = request.rawHeaders.filter(
      (_value, index) =>
        index % 2 === 0 &&
        request.rawHeaders[index]!.toLowerCase() === UPGRADE_CLIENT_IP_HEADER,
    );
    expect(copies).toHaveLength(1);
    // The realtime process sees the app server as its peer.
    const realtime = {
      socket: { remoteAddress: "127.0.0.1" },
      headers: {
        [UPGRADE_CLIENT_IP_HEADER]: request.headers[UPGRADE_CLIENT_IP_HEADER],
      },
    };
    // X-Forwarded-For from an untrusted peer is ignored by the app server.
    expect(deriveUpgradeClientId(realtime as never)).toBe("203.0.113.50");
  });

  it("only strips the header when no secret is set", async () => {
    const { stampUpgradeClientIp } =
      await import("@/lib/collaboration/upgrade-policy");
    const request = {
      socket: { remoteAddress: "203.0.113.50" },
      headers: { [UPGRADE_CLIENT_IP_HEADER]: "spoofed" } as Record<
        string,
        string
      >,
      rawHeaders: ["x-memoria-upgrade-client-ip", "spoofed"],
    };
    stampUpgradeClientIp(request as never, undefined);
    expect(request.rawHeaders).toEqual([]);
    expect(request.headers[UPGRADE_CLIENT_IP_HEADER]).toBeUndefined();
  });
});

describe("through the real upgrade proxy", () => {
  it("delivers each browser's address to the realtime process and drops a spoofed header", async () => {
    const { createServer } = await import("http");
    const { connect } = await import("net");
    const { proxySyncUpgrade } =
      await import("@/lib/collaboration/sync/upgrade-proxy");
    const { stampUpgradeClientIp } =
      await import("@/lib/collaboration/upgrade-policy");
    vi.stubEnv("COLLABORATION_PROXY_SECRET", SECRET);
    vi.stubEnv("TRUSTED_PROXY_CIDRS", "");

    const seen: string[] = [];
    const realtime = createServer();
    realtime.on("upgrade", (request, socket) => {
      seen.push(deriveUpgradeClientId(request));
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    });
    const app = createServer();
    const listen = (server: typeof app) =>
      new Promise<number>((resolve) =>
        server.listen(0, "127.0.0.1", () =>
          resolve((server.address() as { port: number }).port),
        ),
      );
    const realtimePort = await listen(realtime);
    app.on("upgrade", (request, socket, head) => {
      stampUpgradeClientIp(request, SECRET);
      proxySyncUpgrade(
        new URL(`http://127.0.0.1:${realtimePort}`),
        request,
        socket,
        head,
      );
    });
    const appPort = await listen(app);

    const upgradeFrom = (localAddress: string, extra = "") =>
      new Promise<void>((resolve, reject) => {
        const socket = connect({
          port: appPort,
          host: "127.0.0.1",
          localAddress,
        });
        socket.on("error", reject);
        socket.on("close", () => resolve());
        socket.write(
          `GET /api/collaboration/sync HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n${extra}\r\n`,
        );
        socket.resume();
      });
    try {
      // Loopback aliases stand in for two browsers; the realtime process's
      // TCP peer is the app server (127.0.0.1) for both.
      await upgradeFrom("127.0.0.2");
      await upgradeFrom(
        "127.0.0.3",
        `X-Memoria-Upgrade-Client-Ip: ${signUpgradeClientIp("10.9.9.9", "x".repeat(40))}\r\n`,
      );
      expect(seen).toEqual(["127.0.0.2", "127.0.0.3"]);
    } finally {
      app.close();
      realtime.close();
    }
  });
});
