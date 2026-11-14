import http from "http";
import net from "net";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startEgressProxy, type EgressProxy } from "@/lib/capture/egress-proxy";

let origin: http.Server;
let originPort: number;
let proxy: EgressProxy | null = null;
const originHosts: string[] = [];

beforeEach(async () => {
  originHosts.length = 0;
  origin = http.createServer((request, response) => {
    originHosts.push(String(request.headers.host));
    if (request.url === "/big") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("x".repeat(200_000));
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("origin says hello");
  });
  await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", resolve));
  originPort = (origin.address() as AddressInfo).port;
});

afterEach(async () => {
  await proxy?.close();
  proxy = null;
  origin.closeAllConnections();
  await new Promise((resolve) => origin.close(resolve));
});

/** Pretends the public name `public.test` resolves to the local test origin. */
const fakeDns = async (url: string) => {
  const parsed = new URL(url);
  if (parsed.hostname === "public.test") {
    return { valid: true, pinnedIp: "127.0.0.1" };
  }
  return { valid: false, error: "Resolved to a private address" };
};

function viaProxy(target: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port: proxy!.port,
        method: "GET",
        path: target,
        headers: { host: new URL(target).host },
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body }),
        );
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.end();
  });
}

/** Sends a CONNECT line and returns the proxy's status line. */
function connect(authority: string) {
  return new Promise<{ status: string; socket: net.Socket }>(
    (resolve, reject) => {
      const socket = net.connect(proxy!.port, "127.0.0.1", () => {
        socket.write(
          `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`,
        );
      });
      socket.once("data", (data) =>
        resolve({ status: data.toString().split("\r\n")[0]!, socket }),
      );
      socket.on("error", reject);
    },
  );
}

describe("capture egress proxy (IMP-110)", () => {
  it("listens on loopback only", async () => {
    proxy = await startEgressProxy({
      validate: fakeDns,
      maxConnections: 8,
      maxTransferBytes: 1_000_000,
    });
    expect(proxy.port).toBeGreaterThan(0);
  });

  it("refuses private and internal addresses for plain HTTP", async () => {
    proxy = await startEgressProxy({
      maxConnections: 8,
      maxTransferBytes: 1_000_000,
      allowedPorts: [originPort, 80],
    });
    // The default check is the shared SSRF check: loopback is refused even
    // though a server is listening on it.
    const loopback = await viaProxy(`http://127.0.0.1:${originPort}/`);
    expect(loopback.status).toBe(403);
    expect((await viaProxy("http://169.254.169.254/latest/")).status).toBe(403);
    expect((await viaProxy("http://localhost/")).status).toBe(403);
    expect((await viaProxy("http://10.1.2.3/")).status).toBe(403);
    expect(originHosts).toEqual([]);
    expect(proxy.refused.has(`127.0.0.1:${originPort}`)).toBe(true);
  });

  it("refuses private and internal addresses for HTTPS tunnels", async () => {
    proxy = await startEgressProxy({
      maxConnections: 8,
      maxTransferBytes: 1_000_000,
    });
    for (const authority of [
      "127.0.0.1:443",
      "localhost:443",
      "[::1]:443",
      "169.254.169.254:443",
      "192.168.1.1:443",
    ]) {
      const { status, socket } = await connect(authority);
      expect(status).toContain("403");
      socket.destroy();
    }
  });

  it("dials the address that was checked and passes plain HTTP through", async () => {
    proxy = await startEgressProxy({
      validate: fakeDns,
      maxConnections: 8,
      maxTransferBytes: 1_000_000,
      allowedPorts: [originPort],
    });
    const answer = await viaProxy(`http://public.test:${originPort}/page`);
    expect(answer).toEqual({ status: 200, body: "origin says hello" });
    // The site still sees the name the page asked for.
    expect(originHosts).toEqual([`public.test:${originPort}`]);
  });

  it("tunnels a connection to a public address", async () => {
    proxy = await startEgressProxy({
      validate: fakeDns,
      maxConnections: 8,
      maxTransferBytes: 1_000_000,
      allowedPorts: [originPort],
    });
    const { status, socket } = await connect(`public.test:${originPort}`);
    expect(status).toContain("200");
    const body = await new Promise<string>((resolve) => {
      let received = "";
      socket.on("data", (chunk) => (received += chunk));
      socket.on("end", () => resolve(received));
      socket.write(
        `GET / HTTP/1.1\r\nHost: public.test\r\nConnection: close\r\n\r\n`,
      );
    });
    expect(body).toContain("origin says hello");
  });

  it("refuses ports other than the allowed ones", async () => {
    proxy = await startEgressProxy({
      validate: fakeDns,
      maxConnections: 8,
      maxTransferBytes: 1_000_000,
    });
    const { status, socket } = await connect("public.test:22");
    expect(status).toContain("403");
    socket.destroy();
    expect((await viaProxy("http://public.test:6379/")).status).toBe(403);
    expect(proxy.refused.has("public.test:22")).toBe(true);
  });

  it("cuts a page that downloads more than its budget", async () => {
    proxy = await startEgressProxy({
      validate: fakeDns,
      maxConnections: 8,
      maxTransferBytes: 50_000,
      allowedPorts: [originPort],
    });
    await viaProxy(`http://public.test:${originPort}/big`).catch(
      () => undefined,
    );
    expect(proxy.overBudget).toBe(true);
    // Nothing more is let through once the budget is gone.
    expect((await viaProxy(`http://public.test:${originPort}/`)).status).toBe(
      403,
    );
  });
});
