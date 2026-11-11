/**
 * IMP-042 — forward document sync upgrades from the app server to the sync
 * server, so browsers use one origin whether or not a gateway routes
 * `/api/collaboration/sync` itself (the reference Caddyfile does; local
 * development and single-port deployments rely on this proxy).
 *
 * The upgrade request is replayed byte-for-byte apart from X-Forwarded-For,
 * which gains the connecting peer. The sync server authenticates and
 * authorizes the connection itself.
 *
 * @module lib/collaboration/sync/upgrade-proxy
 */

import type { IncomingMessage } from "http";
import { connect, isIP } from "net";
import type { Duplex } from "stream";
import { connect as connectTls } from "tls";

const SECURE_PROTOCOLS = new Set(["https:", "wss:"]);
const SUPPORTED_PROTOCOLS = new Set(["http:", "ws:", ...SECURE_PROTOCOLS]);

/**
 * Fail fast on a sync upstream the proxy cannot speak to. Called at startup so
 * a mistyped SYNC_SERVER_INTERNAL_URL crashes the server instead of every
 * collaboration socket.
 */
export function assertSupportedSyncUpstream(target: URL): void {
  if (!SUPPORTED_PROTOCOLS.has(target.protocol)) {
    throw new Error(
      `Unsupported sync upstream scheme ${target.protocol} (use http:, https:, ws: or wss:)`,
    );
  }
}

export function proxySyncUpgrade(
  target: URL,
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const secure = SECURE_PROTOCOLS.has(target.protocol);
  const port = Number(target.port || (secure ? 443 : 80));
  // URL keeps IPv6 literals bracketed; sockets want the bare address.
  const host = target.hostname.replace(/^\[(.*)\]$/, "$1");
  // An https:/wss: upstream gets a verified TLS connection (SNI set to the
  // target's name); nothing is written until the handshake completes.
  const upstream = secure
    ? connectTls({
        host,
        port,
        // SNI carries names only (RFC 6066); certificate checks still apply.
        ...(isIP(host) ? {} : { servername: host }),
      })
    : connect(port, host);
  let connected = false;

  upstream.once(secure ? "secureConnect" : "connect", () => {
    connected = true;
    const forwarded = [
      request.headers["x-forwarded-for"],
      request.socket.remoteAddress,
    ]
      .filter(Boolean)
      .join(", ");
    const lines = [`${request.method} ${request.url} HTTP/1.1`];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = request.rawHeaders[index];
      if (name.toLowerCase() === "x-forwarded-for") continue;
      lines.push(`${name}: ${request.rawHeaders[index + 1]}`);
    }
    if (forwarded) lines.push(`X-Forwarded-For: ${forwarded}`);
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length > 0) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });

  upstream.on("error", () => {
    if (!connected && socket.writable)
      socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    else socket.destroy();
  });
  upstream.on("close", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
  socket.on("close", () => upstream.destroy());
}
