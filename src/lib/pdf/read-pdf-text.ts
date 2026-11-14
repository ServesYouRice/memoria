/**
 * Read the text of an untrusted PDF (IMP-113). Server only.
 *
 * The parsing runs in its own worker thread with pdf.js (`pdfjs-dist`, pure
 * JavaScript: no browser and no native build), so the limits are hard ones:
 * the thread is stopped when it runs past the time limit or the caller's
 * signal, and its heap is capped. The file size and page count are checked
 * before any page is read, and at most `maxTextBytes` of text is returned.
 * Script evaluation, font loading and network fetching in pdf.js are off.
 * Pictures of text (scanned pages) are not read.
 */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { RESOURCE_BUDGETS } from "@/lib/policy/resource-budgets";

export interface PdfReadLimits {
  maxReadBytes: number;
  maxPages: number;
  maxTextBytes: number;
  timeoutMs: number;
  heapMb: number;
}

export const PDF_READ_LIMITS: PdfReadLimits = {
  maxReadBytes: RESOURCE_BUDGETS.pdf.maxReadBytes,
  maxPages: RESOURCE_BUDGETS.pdf.maxPages,
  maxTextBytes: RESOURCE_BUDGETS.pdf.maxTextBytesPerFile,
  timeoutMs: RESOURCE_BUDGETS.pdf.readTimeoutMs,
  heapMb: RESOURCE_BUDGETS.pdf.readHeapMb,
};

export type PdfReadResult =
  | { status: "text"; pageCount: number; text: string; truncated: boolean }
  | { status: "no-text"; pageCount: number }
  | { status: "too-many-pages"; pageCount: number }
  | { status: "too-large" }
  | {
      status: "unreadable";
      reason: "damaged" | "locked" | "timed-out" | "out-of-memory";
    };

type WorkerAnswer =
  | { kind: "pages"; pageCount: number }
  | { kind: "text"; pageCount: number; text: string; truncated: boolean }
  | { kind: "failed"; locked: boolean };

/**
 * Runs inside the worker thread (plain JavaScript, evaluated as CommonJS).
 * Pages are joined with a blank line; a line break inside a page follows the
 * PDF's own end-of-line marks.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const { pdfjsUrl, data, maxPages, maxTextBytes } = workerData;
(async () => {
  const pdfjs = await import(pdfjsUrl);
  const task = pdfjs.getDocument({
    data,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    enableXfa: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (error) {
    parentPort.postMessage({
      kind: "failed",
      locked: Boolean(error && error.name === "PasswordException"),
    });
    return;
  }
  const pageCount = doc.numPages;
  if (pageCount > maxPages) {
    parentPort.postMessage({ kind: "pages", pageCount });
    return;
  }
  const parts = [];
  let bytes = 0;
  let truncated = false;
  for (let number = 1; number <= pageCount && !truncated; number += 1) {
    const page = await doc.getPage(number);
    const content = await page.getTextContent();
    let pageText = "";
    for (const item of content.items) {
      if (typeof item.str !== "string") continue;
      pageText += item.str + (item.hasEOL ? "\\n" : "");
    }
    page.cleanup();
    pageText = pageText.replace(/[ \\t\\f\\v\\u00a0]+/g, " ").replace(/ *\\n */g, "\\n").trim();
    if (!pageText) continue;
    const size = Buffer.byteLength(pageText, "utf8") + 2;
    if (bytes + size > maxTextBytes) truncated = true;
    parts.push(pageText);
    bytes += size;
  }
  parentPort.postMessage({
    kind: "text",
    pageCount,
    text: parts.join("\\n\\n"),
    truncated,
  });
})().catch(() => {
  parentPort.postMessage({ kind: "failed", locked: false });
});
`;

let pdfjsUrl: string | null = null;

function resolvePdfjs(): string {
  pdfjsUrl ??= pathToFileURL(
    createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.mjs"),
  ).href;
  return pdfjsUrl;
}

/** Cut text to at most `maxBytes` of UTF-8 without splitting a character. */
function trimUtf8(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (buffer[end]! & 0xc0) === 0x80) end -= 1;
  return buffer.subarray(0, end).toString("utf8");
}

/**
 * Read a PDF's text within `limits`. Resolves with what was found; rejects
 * only when `signal` aborts (the thread is stopped first).
 */
export async function readPdfText(
  bytes: Uint8Array,
  options: { signal?: AbortSignal; limits?: Partial<PdfReadLimits> } = {},
): Promise<PdfReadResult> {
  const limits = { ...PDF_READ_LIMITS, ...options.limits };
  options.signal?.throwIfAborted();
  if (bytes.byteLength > limits.maxReadBytes) return { status: "too-large" };

  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: {
      pdfjsUrl: resolvePdfjs(),
      // A copy: pdf.js takes ownership of the bytes it is given.
      data: new Uint8Array(bytes),
      maxPages: limits.maxPages,
      maxTextBytes: limits.maxTextBytes,
    },
    resourceLimits: { maxOldGenerationSizeMb: limits.heapMb },
    // pdf.js prints warnings (missing canvas binding, bad objects); they are
    // not the app's output.
    stdout: true,
    stderr: true,
  });
  worker.stdout.resume();
  worker.stderr.resume();

  type Ending = WorkerAnswer | "timed-out" | "out-of-memory" | "crashed";
  const answer = await new Promise<Ending>((resolve, reject) => {
    let settled = false;
    const finish = (value: Ending, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      void worker.terminate();
      if (error !== undefined) reject(error);
      else resolve(value);
    };
    const onAbort = () => finish("crashed", options.signal?.reason);
    const timer = setTimeout(() => finish("timed-out"), limits.timeoutMs);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    worker.once("message", (message: WorkerAnswer) => finish(message));
    worker.once("error", (error: NodeJS.ErrnoException) =>
      finish(
        error?.code === "ERR_WORKER_OUT_OF_MEMORY"
          ? "out-of-memory"
          : "crashed",
      ),
    );
    worker.once("exit", () => finish("crashed"));
  });

  if (answer === "timed-out" || answer === "out-of-memory") {
    return { status: "unreadable", reason: answer };
  }
  if (answer === "crashed") return { status: "unreadable", reason: "damaged" };
  if (answer.kind === "failed") {
    return {
      status: "unreadable",
      reason: answer.locked ? "locked" : "damaged",
    };
  }
  if (answer.kind === "pages") {
    return { status: "too-many-pages", pageCount: answer.pageCount };
  }
  const text = trimUtf8(answer.text, limits.maxTextBytes).trim();
  if (!text) return { status: "no-text", pageCount: answer.pageCount };
  return {
    status: "text",
    pageCount: answer.pageCount,
    text,
    truncated: answer.truncated,
  };
}
