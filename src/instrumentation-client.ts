/**
 * Next.js client instrumentation (src/, next to the app directory).
 *
 * Next.js runs this before the app hydrates. Browser telemetry is opt-in:
 * only a production build whose server rendered a browser DSN into the page
 * (`SENTRY_BROWSER_DSN`, read at request time: IMP-151) loads the Sentry
 * config, and it loads as its own chunk. A page without the DSN tag never
 * fetches any Sentry code (IMP-116: that code was most of the shared budget).
 *
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client
 */
import { readBrowserSentryConfig } from "@/lib/telemetry/browser-sentry";

function documentParsed(): Promise<void> {
  if (document.readyState !== "loading") return Promise.resolve();
  return new Promise((resolve) =>
    document.addEventListener("DOMContentLoaded", () => resolve(), {
      once: true,
    }),
  );
}

async function loadBrowserSentry(): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  // The tags are in <head>, so they are normally parsed before this runs;
  // wait for the document only if they are not there yet.
  let config = readBrowserSentryConfig(document);
  if (!config && document.readyState === "loading") {
    await documentParsed();
    config = readBrowserSentryConfig(document);
  }
  if (!config) return;
  const { initBrowserSentry } = await import("../sentry.client.config");
  initBrowserSentry(config);
}

void loadBrowserSentry().catch(() => {
  // Telemetry must never break the page.
});
