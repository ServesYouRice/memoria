import "../src/lib/env";
import { prisma } from "../src/lib/db";
import { runOutboxWorker } from "../src/lib/outbox/worker";
import {
  PAGE_CAPTURE_JOB,
  PAGE_CAPTURE_TIMEOUT_MS,
  createPageCaptureHandler,
  pageCaptureEnabled,
} from "../src/lib/services/page-capture";

// IMP-110: the optional page-capture worker. It runs a headless browser, so
// it is its own process (compose profile `capture`) and claims only
// `link.capture` jobs; the normal outbox worker never starts a browser.
if (!pageCaptureEnabled()) {
  throw new Error(
    "Page capture is off. Set PAGE_CAPTURE=true to run the capture worker.",
  );
}

const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

await runOutboxWorker({
  prisma,
  handlers: { [PAGE_CAPTURE_JOB]: createPageCaptureHandler(prisma) },
  signal: controller.signal,
  leaseMs: Number(process.env.OUTBOX_LEASE_MS || 180_000),
  handlerTimeoutMs: PAGE_CAPTURE_TIMEOUT_MS,
  // One page at a time: a browser is the heaviest thing Memoria runs.
  concurrency: Number(process.env.CAPTURE_CONCURRENCY || 1),
});
await prisma.$disconnect();
