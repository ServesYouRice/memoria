/**
 * The only way the capture browser reaches the network (IMP-110).
 *
 * A page can load anything: scripts, frames, images, redirects. Checking the
 * page's own address is not enough, and checking each request inside the
 * browser leaves a gap between the DNS answer the check saw and the one the
 * browser uses. So the browser is pointed at this local forward proxy and
 * nothing else: every connection it wants (plain HTTP and HTTPS tunnels,
 * for the page and for everything the page loads) is resolved here, refused
 * when the address is private or internal, and dialled by the exact address
 * that was checked. The browser never resolves a name itself.
 *
 * Limits are enforced here too: the ports a page may use, how many
 * connections may be open at once, and how many bytes one capture may
 * download in total.
 */

import http from "http";
import net from "net";
import type { Duplex } from "stream";
import { validateUrlForSsrfWithDns } from "@/lib/utils/ssrf-protection";

type Validate = (url: string) => Promise<{
  valid: boolean;
  error?: string;
  pinnedIp?: string;
}>;

export interface EgressProxyOptions {
  /** Defaults to the SSRF check used by every other server-side fetch. */
  validate?: Validate;
  /** Ports a page may reach. Anything else is refused. */
  allowedPorts?: readonly number[];
  /** Open connections at once; more are refused. */
  maxConnections: number;
  /** Bytes one capture may download through the proxy in total. */
  maxTransferBytes: number;
  /** Milliseconds a connection may sit idle before it is closed. */
  idleTimeoutMs?: number;
}

export interface EgressProxy {
  port: number;
  /** Hosts refused so far (private, internal, or a port that is not allowed). */
  refused: ReadonlySet<string>;
  /** True once the download budget was used up and connections were cut. */
  readonly overBudget: boolean;
  close(): Promise<void>;
}

const DEFAULT_PORTS = [80, 443] as const;
const HOP_BY_HOP = [
  "proxy-connection",
  "proxy-authorization",
  "connection",
  "keep-alive",
  "te",
  "trailer",
  "upgrade",
];

/** `host:port` of a CONNECT line; IPv6 literals come bracketed. */
function parseAuthority(
  authority: string,
  fallbackPort: number,
): { host: string; port: number } | null {
  try {
    const parsed = new URL(`http://${authority}`);
    return {
      host: parsed.hostname.replace(/^\[|\]$/g, ""),
      port: parsed.port ? Number(parsed.port) : fallbackPort,
    };
  } catch {
    return null;
  }
}

export async function startEgressProxy(
  options: EgressProxyOptions,
): Promise<EgressProxy> {
  const validate = options.validate ?? validateUrlForSsrfWithDns;
  const allowedPorts = new Set<number>(options.allowedPorts ?? DEFAULT_PORTS);
  const idleTimeoutMs = options.idleTimeoutMs ?? 30_000;
  const refused = new Set<string>();
  const sockets = new Set<Duplex>();
  let transferred = 0;
  let overBudget = false;

  const cutAll = () => {
    for (const socket of sockets) socket.destroy();
  };

  const track = <T extends Duplex>(socket: T): T => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    return socket;
  };

  /** Count bytes coming back from the internet against the budget. */
  const count = (chunk: Buffer) => {
    transferred += chunk.length;
    if (transferred > options.maxTransferBytes && !overBudget) {
      overBudget = true;
      cutAll();
    }
  };

  /** The address to dial for `host:port`, or null when it is refused. */
  const resolveTarget = async (
    host: string,
    port: number,
    scheme: "http" | "https",
  ) => {
    if (!allowedPorts.has(port) || overBudget) {
      refused.add(`${host}:${port}`);
      return null;
    }
    const hostForUrl = net.isIPv6(host) ? `[${host}]` : host;
    const checked = await validate(`${scheme}://${hostForUrl}/`).catch(
      () => null,
    );
    if (!checked?.valid || !checked.pinnedIp) {
      refused.add(`${host}:${port}`);
      return null;
    }
    return checked.pinnedIp;
  };

  const server = http.createServer(async (request, response) => {
    // A proxy request carries an absolute URL; anything else is someone
    // talking to the proxy itself.
    let target: URL;
    try {
      target = new URL(request.url ?? "");
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (target.protocol !== "http:") {
      response.writeHead(400).end();
      return;
    }
    if (sockets.size > options.maxConnections) {
      response.writeHead(503).end();
      return;
    }
    const port = target.port ? Number(target.port) : 80;
    const host = target.hostname.replace(/^\[|\]$/g, "");
    const address = await resolveTarget(host, port, "http");
    if (!address) {
      response.writeHead(403).end();
      return;
    }
    const headers = { ...request.headers };
    for (const name of HOP_BY_HOP) delete headers[name];
    // Redirects are the browser's to follow, so each hop is checked again.
    const upstream = http.request(
      {
        host: address,
        port,
        method: request.method,
        path: `${target.pathname}${target.search}`,
        headers,
        timeout: idleTimeoutMs,
      },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.on("data", count);
        answer.pipe(response);
      },
    );
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
  });
  server.on("connection", (socket) => {
    track(socket);
  });

  server.on("connect", async (request, clientSocket: Duplex, head: Buffer) => {
    const refuse = (status: string) => {
      clientSocket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    };
    const authority = parseAuthority(request.url ?? "", 443);
    if (!authority) return refuse("400 Bad Request");
    if (sockets.size > options.maxConnections) {
      return refuse("503 Service Unavailable");
    }
    const address = await resolveTarget(
      authority.host,
      authority.port,
      "https",
    );
    if (!address) return refuse("403 Forbidden");
    const upstream = track(
      net.connect({ host: address, port: authority.port }),
    );
    upstream.on("data", count);
    upstream.setTimeout(idleTimeoutMs, () => upstream.destroy());
    upstream.once("connect", () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.once("error", () => {
      if (!clientSocket.writableEnded) refuse("502 Bad Gateway");
    });
    clientSocket.once("close", () => upstream.destroy());
    upstream.once("close", () => clientSocket.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    // Loopback only: nothing but the browser this process starts can use it.
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const bound = server.address();
  if (!bound || typeof bound === "string") {
    throw new Error("Capture egress proxy did not bind a port");
  }

  return {
    port: bound.port,
    refused,
    get overBudget() {
      return overBudget;
    },
    close: () =>
      new Promise<void>((resolve) => {
        cutAll();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
