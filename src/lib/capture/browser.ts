/**
 * Headless-browser capture of one saved page (IMP-110): a picture and a PDF.
 *
 * This runs only in the optional capture worker. The browser has no network
 * of its own: it is launched with every connection sent through the local
 * egress proxy, which refuses private and internal addresses for the page and
 * for everything the page loads (see egress-proxy.ts), and its own name
 * lookups are switched off. A capture has a time limit, a limit on the
 * requests the page may make, a limit on the bytes it may download, and a
 * limit on the size of each file kept.
 */

import type { Browser } from "playwright-core";
import { RESOURCE_BUDGETS } from "@/lib/policy/resource-budgets";
import { startEgressProxy, type EgressProxy } from "./egress-proxy";

export const CAPTURE_IMAGE_MIME_TYPE = "image/jpeg";
export const CAPTURE_PDF_MIME_TYPE = "application/pdf";

export interface PageCaptureResult {
  /** A JPEG of the top of the page, within the size budget. */
  image: Buffer | null;
  /** A PDF of the page, within the size budget. */
  pdf: Buffer | null;
}

/** The page, or something it points at, is on a private or internal address. */
export class PageCaptureRefusedError extends Error {
  readonly retryable = false;
  constructor(message = "The page points at a private or internal address") {
    super(message);
    this.name = "PageCaptureRefusedError";
  }
}

/** The page used up its download budget; another try would do the same. */
export class PageCaptureLimitError extends Error {
  readonly retryable = false;
  constructor(message = "The page downloaded more than a capture may") {
    super(message);
    this.name = "PageCaptureLimitError";
  }
}

/** The page could not be loaded in time; another try may work. */
export class PageCaptureLoadError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = "PageCaptureLoadError";
  }
}

export interface PageCaptureOptions {
  signal?: AbortSignal;
  /** Test hook: replaces the SSRF check inside the egress proxy. */
  validate?: Parameters<typeof startEgressProxy>[0]["validate"];
}

const BUDGET = RESOURCE_BUDGETS.pageCapture;
/** Only these schemes may be loaded by a page; everything else is dropped. */
const ALLOWED_SCHEMES = new Set([
  "http:",
  "https:",
  "data:",
  "blob:",
  "about:",
]);

function browserArgs(proxy: EgressProxy) {
  const args = [
    `--proxy-server=http://127.0.0.1:${proxy.port}`,
    // Send loopback names through the proxy as well, where they are refused.
    "--proxy-bypass-list=<-loopback>",
    // The browser resolves nothing itself: names reach the proxy as names.
    "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1",
    // UDP paths (WebRTC, QUIC) would skip the proxy.
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--disable-quic",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--no-first-run",
  ];
  // Containers usually cannot start the browser's own sandbox; the compose
  // service sets this and relies on the container's limits instead.
  if (process.env.CAPTURE_BROWSER_NO_SANDBOX === "true") {
    args.push("--no-sandbox");
  }
  return args;
}

function deadline<T>(work: Promise<T>, ms: number, signal?: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new PageCaptureLoadError("Capture timed out")),
      ms,
    );
    const onAbort = () =>
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error("Capture aborted"),
      );
    if (signal?.aborted) onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    });
  });
}

/** Capture `url`. The address must already have passed the SSRF check. */
export async function capturePage(
  url: string,
  options: PageCaptureOptions = {},
): Promise<PageCaptureResult> {
  const proxy = await startEgressProxy({
    validate: options.validate,
    maxConnections: BUDGET.maxConnections,
    maxTransferBytes: BUDGET.maxTransferBytes,
  });
  let browser: Browser | null = null;
  let finished = false;
  try {
    const { chromium } = await import("playwright-core");
    return await deadline(
      (async () => {
        const launched = await chromium.launch({
          headless: true,
          executablePath: process.env.CAPTURE_BROWSER_PATH || undefined,
          args: browserArgs(proxy),
        });
        browser = launched;
        // The deadline passed while the browser was starting: end it now.
        if (finished) {
          await launched.close().catch(() => undefined);
          throw new PageCaptureLoadError("Capture timed out");
        }
        const context = await launched.newContext({
          viewport: BUDGET.viewport,
          serviceWorkers: "block",
          acceptDownloads: false,
          permissions: [],
        });
        let requests = 0;
        await context.route("**/*", (route) => {
          requests += 1;
          let scheme = "";
          try {
            scheme = new URL(route.request().url()).protocol;
          } catch {
            // An address that does not parse is dropped below.
          }
          if (requests > BUDGET.maxRequests || !ALLOWED_SCHEMES.has(scheme)) {
            return route.abort("blockedbyclient");
          }
          return route.continue();
        });
        const page = await context.newPage();
        try {
          await page.goto(url, {
            waitUntil: "load",
            timeout: BUDGET.navigationTimeoutMs,
          });
        } catch (error) {
          // The page, or a redirect on the way to it, was refused by the
          // proxy: do not try again.
          if (proxy.refused.size > 0) throw new PageCaptureRefusedError();
          throw new PageCaptureLoadError(
            error instanceof Error ? error.message : "Page did not load",
          );
        }
        if (!ALLOWED_SCHEMES.has(new URL(page.url()).protocol)) {
          throw new PageCaptureRefusedError("The page left http and https");
        }
        // Let late scripts settle, but never wait for a page that keeps
        // polling.
        await page
          .waitForLoadState("networkidle", { timeout: BUDGET.settleMs })
          .catch(() => undefined);

        const height = await page.evaluate(() =>
          Math.max(
            document.documentElement?.scrollHeight ?? 0,
            document.body?.scrollHeight ?? 0,
          ),
        );
        const clipHeight = Math.max(
          1,
          Math.min(height, BUDGET.maxPageHeightPx),
        );
        let image: Buffer | null = null;
        for (const quality of [70, 40]) {
          const shot = await page.screenshot({
            type: "jpeg",
            quality,
            fullPage: true,
            clip: {
              x: 0,
              y: 0,
              width: BUDGET.viewport.width,
              height: clipHeight,
            },
          });
          if (shot.length <= BUDGET.maxImageBytes) {
            image = shot;
            break;
          }
        }
        await page.emulateMedia({ media: "print" });
        const printed = await page.pdf({ format: "A4", printBackground: true });
        return {
          image,
          pdf: printed.length <= BUDGET.maxPdfBytes ? printed : null,
        };
      })(),
      BUDGET.totalTimeoutMs,
      options.signal,
    );
  } catch (error) {
    if (proxy.overBudget) {
      throw new PageCaptureLimitError();
    }
    throw error;
  } finally {
    finished = true;
    // Closing the browser ends everything the page started.
    await (browser as Browser | null)?.close().catch(() => undefined);
    await proxy.close();
  }
}
