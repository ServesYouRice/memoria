import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server } from "http";
import type { AddressInfo } from "net";
import WebSocket, { WebSocketServer } from "ws";
import { proxySyncUpgrade } from "@/lib/collaboration/sync/upgrade-proxy";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

function listen(server: Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as AddressInfo).port),
    ),
  );
}

async function startFront(target: URL): Promise<number> {
  const front = createServer();
  front.on("upgrade", (request, socket, head) =>
    proxySyncUpgrade(target, request, socket, head),
  );
  const port = await listen(front);
  closers.push(
    () =>
      new Promise((resolve) => {
        front.closeAllConnections();
        front.close(() => resolve());
      }),
  );
  return port;
}

describe("sync upgrade proxy", () => {
  it("replays the upgrade to the sync server and pipes frames both ways", async () => {
    const upstreamHttp = createServer();
    const upstream = new WebSocketServer({ server: upstreamHttp });
    const seen: IncomingMessage[] = [];
    upstream.on("connection", (socket, request) => {
      seen.push(request);
      socket.on("message", (data) => socket.send(`echo:${data}`));
    });
    const upstreamPort = await listen(upstreamHttp);
    closers.push(
      () =>
        new Promise((resolve) => {
          for (const client of upstream.clients) client.terminate();
          upstream.close();
          upstreamHttp.close(() => resolve());
        }),
    );
    const frontPort = await startFront(
      new URL(`http://127.0.0.1:${upstreamPort}`),
    );

    const client = new WebSocket(
      `ws://127.0.0.1:${frontPort}/api/collaboration/sync`,
      {
        headers: {
          origin: "http://localhost:3000",
          cookie: "memoria.session_token=abc",
          "x-forwarded-for": "198.51.100.7",
        },
      },
    );
    const reply = await new Promise<string>((resolve, reject) => {
      client.once("open", () => client.send("hello"));
      client.once("message", (data) => resolve(String(data)));
      client.once("error", reject);
    });
    client.close();

    expect(reply).toBe("echo:hello");
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("/api/collaboration/sync");
    expect(seen[0].headers.origin).toBe("http://localhost:3000");
    expect(seen[0].headers.cookie).toBe("memoria.session_token=abc");
    expect(seen[0].headers["x-forwarded-for"]).toBe("198.51.100.7, 127.0.0.1");
  });

  it("answers 502 when the sync server is unreachable", async () => {
    const unused = createServer();
    const port = await listen(unused);
    await new Promise<void>((resolve) => unused.close(() => resolve()));
    const frontPort = await startFront(new URL(`http://127.0.0.1:${port}`));

    const status = await new Promise<number>((resolve) => {
      const client = new WebSocket(
        `ws://127.0.0.1:${frontPort}/api/collaboration/sync`,
      );
      client.once("unexpected-response", (_request, response) => {
        resolve(response.statusCode ?? 0);
        client.terminate();
      });
      client.on("error", () => undefined);
    });
    expect(status).toBe(502);
  });
});
