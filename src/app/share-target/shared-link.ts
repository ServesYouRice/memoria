/**
 * Parsing for the phone share target (IMP-062).
 *
 * The installed PWA declares a GET `share_target` in `public/manifest.json`,
 * so a share arrives as `/share-target?title=&text=&url=`. Many Android apps
 * leave `url` empty and put the link inside `text` ("Look at this
 * https://…"), so the link is pulled out of the text when needed.
 */

export const SHARE_TARGET_PATH = "/share-target";

/** Query parameter that names one share, so a reload replays it. */
export const SHARE_ID_PARAM = "sid";
export const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

const MAX_TITLE_LENGTH = 500;
const MAX_PARAM_LENGTH = 8192;
const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/i;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}»”’]+$/;
// What is left around the link once it is cut out of the text ("see: …").
const LEFTOVER_SEPARATORS = /^[\s.,;:()[\]\-–—]+|[\s.,;:()[\]\-–—]+$/g;

export interface SharedParams {
  title?: string;
  text?: string;
  url?: string;
  sid?: string;
}

export interface SharedLink {
  url: string;
  title?: string;
}

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.slice(0, MAX_PARAM_LENGTH).trim();
  return trimmed ? trimmed : undefined;
}

/** Read the share parameters from Next's `searchParams`. */
export function readSharedParams(params: RawParams): SharedParams {
  return {
    title: first(params.title),
    text: first(params.text),
    url: first(params.url),
    sid: first(params[SHARE_ID_PARAM]),
  };
}

function asHttpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? value
      : null;
  } catch {
    return null;
  }
}

/** The first http(s) link in free text, without trailing punctuation. */
export function extractUrlFromText(text: string | undefined): string | null {
  if (!text) return null;
  const match = URL_IN_TEXT.exec(text);
  if (!match) return null;
  return asHttpUrl(match[0].replace(TRAILING_PUNCTUATION, ""));
}

/**
 * The link a share carries, or null when it carries none. The title is the
 * shared title, else the shared text with the link removed.
 */
export function parseSharedLink(params: SharedParams): SharedLink | null {
  const url =
    asHttpUrl(params.url) ??
    extractUrlFromText(params.url) ??
    extractUrlFromText(params.text);
  if (!url) return null;

  const textTitle = params.text
    ?.replace(url, "")
    .replace(/\s+/g, " ")
    .replace(LEFTOVER_SEPARATORS, "");
  const title = (params.title || textTitle || "").slice(0, MAX_TITLE_LENGTH);
  return title ? { url, title } : { url };
}

/** `/share-target?…` carrying the same share, optionally with its id. */
export function buildShareTargetHref(params: SharedParams): string {
  const query = new URLSearchParams();
  if (params.title) query.set("title", params.title);
  if (params.text) query.set("text", params.text);
  if (params.url) query.set("url", params.url);
  if (params.sid) query.set(SHARE_ID_PARAM, params.sid);
  const search = query.toString();
  return search ? `${SHARE_TARGET_PATH}?${search}` : SHARE_TARGET_PATH;
}

/**
 * The clip-batch idempotency key for one share. The share id is minted once,
 * on the first authenticated load, and kept in the address bar, so reloading
 * the "Saved" page replays the batch instead of saving the link again.
 */
export function shareIdempotencyKey(shareId: string): string {
  return `share-${shareId}`;
}
