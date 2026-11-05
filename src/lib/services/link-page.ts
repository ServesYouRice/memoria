/**
 * The one SSRF-safe way the server reads a saved link's page: used by the
 * `/api/v1/unfurl` route and by background link enrichment (IMP-064). Every
 * fetch goes through `safeFetch`, which validates and pins each redirect.
 */

import * as cheerio from "cheerio";
import { safeFetch } from "@/lib/utils/ssrf-protection";
import {
  extractMetadata,
  validateMetadata,
  type ExtractedMetadata,
} from "@/lib/utils/metadata-extractor";

export const LINK_PAGE_FETCH_OPTIONS = {
  maxRedirects: 5,
  timeout: 10_000,
  maxSize: 2 * 1024 * 1024,
} as const;

/** Longest readable page text kept in memory for one link. */
export const LINK_PAGE_TEXT_MAX_CHARS = 100_000;

export type LinkPageResult =
  | { ok: true; html: string; metadata: ExtractedMetadata }
  | { ok: false; status: number; error: string };

export async function fetchLinkPage(
  url: string,
  options: { signal?: AbortSignal; timeout?: number } = {},
): Promise<LinkPageResult> {
  const fetched = await safeFetch(url, {
    ...LINK_PAGE_FETCH_OPTIONS,
    timeout: options.timeout ?? LINK_PAGE_FETCH_OPTIONS.timeout,
    signal: options.signal,
  });
  if (!fetched.ok) {
    return {
      ok: false,
      status: fetched.status || 500,
      error: fetched.error || "Failed to fetch URL",
    };
  }
  if (!fetched.data) {
    return { ok: false, status: 500, error: "No data received" };
  }
  return {
    ok: true,
    html: fetched.data,
    metadata: validateMetadata(extractMetadata(fetched.data, url)),
  };
}

/**
 * Readable text of a page: the main/article element when there is one,
 * otherwise the body, without scripts, styles and navigation chrome.
 */
export function extractPageText(
  html: string,
  maxChars = LINK_PAGE_TEXT_MAX_CHARS,
): string {
  const $ = cheerio.load(html);
  $(
    "script, style, noscript, template, svg, iframe, nav, header, footer, aside, form",
  ).remove();
  const root = $("article").first().length
    ? $("article").first()
    : $("main").first().length
      ? $("main").first()
      : $("body");
  return root.text().replace(/\s+/g, " ").trim().slice(0, maxChars);
}
