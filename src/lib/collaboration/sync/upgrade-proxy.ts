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
import { connect } from "net";
import type { Duplex } from "stream";

export function proxySyncUpgrade(
  target: URL,
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const upstream = connect(
    Number(target.port || (target.protocol === "https:" ? 443 : 80)),
    target.hostname,
  );
  let connected = false;

  upstream.once("connect", () => {
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
