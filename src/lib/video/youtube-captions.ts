/**
 * Reading a YouTube video's public captions (IMP-114, DEC-018).
 *
 * YouTube offers no open, official way to read the captions of other
 * people's videos. This reads them the way a browser does: the watch page
 * lists its caption tracks, and each track is a small XML file. It is
 * unofficial and can stop working whenever YouTube changes its pages, so it
 * runs only when the deployment switches it on, and every failure ends
 * quietly with no transcript. Every request goes through the SSRF-safe
 * fetcher, and only YouTube's own caption address is ever followed from the
 * page.
 */

import { safeFetch } from "@/lib/utils/ssrf-protection";
import { formatVideoTime } from "./video-link";

const WATCH_FETCH = {
  maxRedirects: 3,
  timeout: 10_000,
  maxSize: 4 * 1024 * 1024,
} as const;
const TRACK_FETCH = {
  maxRedirects: 2,
  timeout: 10_000,
  maxSize: 2 * 1024 * 1024,
} as const;

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  /** "asr" for automatic captions. */
  kind?: string;
}

export type CaptionFetchResult =
  | { ok: true; text: string; language: string }
  /** The video answered but has no captions this can read. */
  | { ok: false; reason: "no-captions" }
  /** YouTube did not answer usefully; worth another try later. */
  | { ok: false; reason: "unavailable"; status: number };

/** The JSON array that follows `"captionTracks":` in a watch page, if any. */
export function extractCaptionTracks(html: string): CaptionTrack[] {
  const marker = html.indexOf('"captionTracks":');
  if (marker === -1) return [];
  const start = html.indexOf("[", marker);
  if (start === -1) return [];
  let depth = 0;
  let inString = false;
  let end = -1;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (char === "\\") index += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  if (end === -1) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(html.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((track): CaptionTrack[] => {
    if (!track || typeof track !== "object") return [];
    const { baseUrl, languageCode, kind } = track as Record<string, unknown>;
    if (typeof baseUrl !== "string" || typeof languageCode !== "string") {
      return [];
    }
    return [
      {
        baseUrl,
        languageCode,
        ...(typeof kind === "string" ? { kind } : {}),
      },
    ];
  });
}

/**
 * The track to read: captions written by people before automatic ones, and
 * English before other languages (Ask and search work in English).
 */
export function pickCaptionTrack(
  tracks: CaptionTrack[],
): CaptionTrack | undefined {
  const english = (track: CaptionTrack) =>
    track.languageCode.toLowerCase().startsWith("en");
  const manual = (track: CaptionTrack) => track.kind !== "asr";
  return (
    tracks.find((track) => manual(track) && english(track)) ??
    tracks.find(english) ??
    tracks.find(manual) ??
    tracks[0]
  );
}

/** Only YouTube's own caption address is followed from a watch page. */
export function captionTrackUrl(baseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(baseUrl, "https://www.youtube.com");
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "www.youtube.com" && host !== "youtube.com") return null;
  if (url.pathname !== "/api/timedtext") return null;
  url.protocol = "https:";
  url.username = "";
  url.password = "";
  url.port = "";
  return url.toString();
}

function decodeEntities(text: string) {
  return text.replace(
    /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|(amp|lt|gt|quot|apos));/gi,
    (whole, dec: string, hex: string, name: string) => {
      if (dec || hex) {
        const code = dec ? Number(dec) : parseInt(hex, 16);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      }
      switch (name.toLowerCase()) {
        case "amp":
          return "&";
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "quot":
          return '"';
        case "apos":
          return "'";
        default:
          return whole;
      }
    },
  );
}

/** Caption text: tags removed, entities (often encoded twice) decoded. */
function cueText(raw: string) {
  const once = decodeEntities(raw.replace(/<[^>]*>/g, ""));
  const plain = once.replace(/<\/?(?:font|b|i|u|s)\b[^>]*>/gi, "");
  return decodeEntities(plain).replace(/\s+/g, " ").trim();
}

/**
 * Timed lines from a caption file, in either of YouTube's two XML layouts:
 * `<text start="1.5">…</text>` (seconds) or `<p t="1500">…</p>` (ms).
 */
export function parseTimedText(
  xml: string,
): Array<{ start: number; text: string }> {
  const cues: Array<{ start: number; text: string }> = [];
  const pattern =
    /<text\b[^>]*\bstart="([\d.]+)"[^>]*>([\s\S]*?)<\/text>|<p\b[^>]*\bt="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  for (const match of xml.matchAll(pattern)) {
    const start =
      match[1] !== undefined ? Number(match[1]) : Number(match[3]) / 1000;
    const text = cueText(match[2] ?? match[4] ?? "");
    if (text && Number.isFinite(start)) cues.push({ start, text });
  }
  return cues;
}

/** One line per cue, each starting with its moment ("1:05 Hello"). */
export function captionsToTranscript(
  cues: Array<{ start: number; text: string }>,
): string {
  return cues
    .map((cue) => `${formatVideoTime(cue.start)} ${cue.text}`)
    .join("\n");
}

export async function fetchYoutubeCaptions(
  videoId: string,
  options: { signal?: AbortSignal; fetchImpl?: typeof safeFetch } = {},
): Promise<CaptionFetchResult> {
  const fetchImpl = options.fetchImpl ?? safeFetch;
  const page = await fetchImpl(
    `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`,
    { ...WATCH_FETCH, signal: options.signal },
  );
  if (!page.ok || !page.data) {
    return { ok: false, reason: "unavailable", status: page.status || 500 };
  }
  const track = pickCaptionTrack(extractCaptionTracks(page.data));
  const trackUrl = track ? captionTrackUrl(track.baseUrl) : null;
  if (!track || !trackUrl) return { ok: false, reason: "no-captions" };

  const file = await fetchImpl(trackUrl, {
    ...TRACK_FETCH,
    signal: options.signal,
  });
  if (!file.ok) {
    return { ok: false, reason: "unavailable", status: file.status || 500 };
  }
  const text = captionsToTranscript(parseTimedText(file.data ?? ""));
  if (!text) return { ok: false, reason: "no-captions" };
  return { ok: true, text, language: track.languageCode.slice(0, 16) };
}
