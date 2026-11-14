import net from "net";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The browser is replaced by a fake that drives the real egress proxy the way
 * Chromium would: it connects to the proxy named in its launch arguments.
 */
const fake = vi.hoisted(() => ({
  launchOptions: undefined as
    { args: string[]; executablePath?: string } | undefined,
  closed: false,
  routeHandler: undefined as
    | ((route: {
        request: () => { url: () => string };
        abort: (reason: string) => unknown;
        continue: () => unknown;
      }) => unknown)
    | undefined,
  onGoto: undefined as ((proxyPort: number) => Promise<void>) | undefined,
  shot: (quality: number) => Buffer.alloc(quality === 70 ? 10 : 5),
  pdf: Buffer.alloc(20),
}));

vi.mock("playwright-core", () => ({
  chromium: {
    launch: async (options: { args: string[]; executablePath?: string }) => {
      fake.launchOptions = options;
      const proxyPort = Number(
        options.args
          .find((arg) => arg.startsWith("--proxy-server="))!
          .split(":")
          .pop(),
      );
      return {
        close: async () => {
          fake.closed = true;
        },
        newContext: async () => ({
          route: async (
            _pattern: string,
            handler: typeof fake.routeHandler,
          ) => {
            fake.routeHandler = handler;
          },
          newPage: async () => ({
            goto: async () => fake.onGoto?.(proxyPort),
            url: () => "https://news.example/",
            waitForLoadState: async () => undefined,
            evaluate: async () => 5_000,
            screenshot: async (opts: { quality: number }) =>
              fake.shot(opts.quality),
            emulateMedia: async () => undefined,
            pdf: async () => fake.pdf,
          }),
        }),
      };
    },
  },
}));

import { PageCaptureRefusedError, capturePage } from "@/lib/capture/browser";
import { RESOURCE_BUDGETS } from "@/lib/policy/resource-budgets";

/** Ask the proxy for a tunnel, as the browser does for every HTTPS host. */
function tunnel(proxyPort: number, authority: string) {
  return new Promise<string>((resolve, reject) => {
    const socket = net.connect(proxyPort, "127.0.0.1", () =>
      socket.write(
        `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`,
      ),
    );
    socket.once("data", (data) => {
      socket.destroy();
      resolve(data.toString().split("\r\n")[0]!);
    });
    socket.on("error", reject);
  });
}

beforeEach(() => {
  fake.launchOptions = undefined;
  fake.closed = false;
  fake.onGoto = undefined;
  fake.shot = (quality) => Buffer.alloc(quality === 70 ? 10 : 5);
  fake.pdf = Buffer.alloc(20);
  vi.unstubAllEnvs();
});

describe("capture browser (IMP-110)", () => {
  it("starts the browser with no network but the egress proxy", async () => {
    const result = await capturePage("https://news.example/", {
      validate: async () => ({ valid: true, pinnedIp: "93.184.216.34" }),
    });
    const args = fake.launchOptions!.args;
    expect(args.find((arg) => arg.startsWith("--proxy-server="))).toMatch(
      /^--proxy-server=http:\/\/127\.0\.0\.1:\d+$/,
    );
    // Loopback names go through the proxy too, where they are refused.
    expect(args).toContain("--proxy-bypass-list=<-loopback>");
    // The browser resolves no names of its own.
    expect(args).toContain(
      "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1",
    );
    expect(args).toContain("--disable-quic");
    expect(args.some((arg) => arg.includes("disable_non_proxied_udp"))).toBe(
      true,
    );
    expect(args).not.toContain("--no-sandbox");
    expect(result.image).toHaveLength(10);
    expect(result.pdf).toHaveLength(20);
    expect(fake.closed).toBe(true);
  });

  it("only turns the browser sandbox off when the deployment says so", async () => {
    vi.stubEnv("CAPTURE_BROWSER_NO_SANDBOX", "true");
    vi.stubEnv("CAPTURE_BROWSER_PATH", "/usr/bin/chromium");
    await capturePage("https://news.example/");
    expect(fake.launchOptions!.args).toContain("--no-sandbox");
    expect(fake.launchOptions!.executablePath).toBe("/usr/bin/chromium");
  });

  it("refuses a page whose load runs into an internal address", async () => {
    fake.onGoto = async (proxyPort) => {
      // A redirect, frame or script that points at the cloud metadata address.
      expect(await tunnel(proxyPort, "169.254.169.254:443")).toContain("403");
      throw new Error("net::ERR_TUNNEL_CONNECTION_FAILED");
    };
    await expect(capturePage("https://news.example/")).rejects.toBeInstanceOf(
      PageCaptureRefusedError,
    );
    expect(fake.closed).toBe(true);
  });

  it("drops requests beyond the budget and schemes other than http(s)", async () => {
    await capturePage("https://news.example/", {
      validate: async () => ({ valid: true, pinnedIp: "93.184.216.34" }),
    });
    const handler = fake.routeHandler!;
    const route = (url: string) => ({
      request: () => ({ url: () => url }),
      abort: vi.fn(),
      continue: vi.fn(),
    });
    const file = route("file:///etc/passwd");
    await handler(file);
    expect(file.abort).toHaveBeenCalledWith("blockedbyclient");
    const page = route("https://news.example/app.js");
    await handler(page);
    expect(page.continue).toHaveBeenCalled();
    for (let i = 0; i < RESOURCE_BUDGETS.pageCapture.maxRequests; i += 1) {
      await handler(route("https://news.example/x"));
    }
    const over = route("https://news.example/one-too-many");
    await handler(over);
    expect(over.abort).toHaveBeenCalled();
  });

  it("keeps a smaller picture when the first is over the size budget, and none when both are", async () => {
    const limit = RESOURCE_BUDGETS.pageCapture.maxImageBytes;
    fake.shot = (quality) => Buffer.alloc(quality === 70 ? limit + 1 : 7);
    expect((await capturePage("https://news.example/")).image).toHaveLength(7);
    fake.shot = () => Buffer.alloc(limit + 1);
    expect((await capturePage("https://news.example/")).image).toBeNull();
  });

  it("drops a PDF over the size budget", async () => {
    fake.pdf = Buffer.alloc(RESOURCE_BUDGETS.pageCapture.maxPdfBytes + 1);
    expect((await capturePage("https://news.example/")).pdf).toBeNull();
  });
});
