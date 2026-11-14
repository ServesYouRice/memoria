/**
 * Video links (IMP-114): which saved links are videos, where they are from,
 * and how to open one at a moment. Client-safe and pure.
 *
 * DEC-011 stands: a video is never played inside the canvas. These helpers
 * only build ordinary links that open in a new tab.
 */

export type VideoProvider = "youtube" | "vimeo" | "loom";

export interface VideoLink {
  provider: VideoProvider;
  /** The provider's id of the video. */
  id: string;
  /** Where the video is from, for people. */
  source: string;
}

export const VIDEO_PROVIDER_LABELS: Record<VideoProvider, string> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  loom: "Loom",
};

/** The longest moment a note may point at: 100 hours. */
export const MAX_VIDEO_SECONDS = 100 * 60 * 60;

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
]);

function bareHost(url: URL) {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

function youtubeId(url: URL): string | null {
  const host = bareHost(url);
  if (host === "youtu.be") {
    const id = url.pathname.split("/")[1] ?? "";
    return YOUTUBE_ID.test(id) ? id : null;
  }
  if (!YOUTUBE_HOSTS.has(host)) return null;
  if (url.pathname === "/watch") {
    const id = url.searchParams.get("v") ?? "";
    return YOUTUBE_ID.test(id) ? id : null;
  }
  const match = /^\/(?:shorts|live|embed|v)\/([^/]+)/.exec(url.pathname);
  return match && YOUTUBE_ID.test(match[1]!) ? match[1]! : null;
}

function vimeoId(url: URL): string | null {
  const host = bareHost(url);
  if (host === "vimeo.com") {
    const match = /^\/(?:channels\/[^/]+\/)?(\d{3,12})(?:\/|$)/.exec(
      url.pathname,
    );
    return match ? match[1]! : null;
  }
  if (host === "player.vimeo.com") {
    const match = /^\/video\/(\d{3,12})(?:\/|$)/.exec(url.pathname);
    return match ? match[1]! : null;
  }
  return null;
}

function loomId(url: URL): string | null {
  if (bareHost(url) !== "loom.com") return null;
  const match = /^\/(?:share|embed)\/([0-9a-f]{16,64})(?:\/|$)/i.exec(
    url.pathname,
  );
  return match ? match[1]! : null;
}

/** The video a web address points to, or null when it is not a known video. */
export function parseVideoLink(value: unknown): VideoLink | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  for (const [provider, read] of [
    ["youtube", youtubeId],
    ["vimeo", vimeoId],
    ["loom", loomId],
  ] as const) {
    const id = read(url);
    if (id) return { provider, id, source: VIDEO_PROVIDER_LABELS[provider] };
  }
  return null;
}

/**
 * The address that opens a video at `seconds`. Built from the provider's id,
 * so whatever else the saved address carried is not repeated.
 */
export function videoUrlAt(video: VideoLink, seconds: number): string {
  const at = Math.max(0, Math.min(MAX_VIDEO_SECONDS, Math.floor(seconds)));
  switch (video.provider) {
    case "youtube":
      return `https://www.youtube.com/watch?v=${video.id}${at ? `&t=${at}s` : ""}`;
    case "vimeo":
      return `https://vimeo.com/${video.id}${at ? `#t=${at}s` : ""}`;
    case "loom":
      return `https://www.loom.com/share/${video.id}${at ? `?t=${at}` : ""}`;
  }
}

/** "1:02:03" or "2:05" for a number of seconds. */
export function formatVideoTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}`
    : `${minutes}:${secs}`;
}

/**
 * Seconds from what a person typed: "75", "1:15", "1:02:03" or "1h2m3s".
 * Null when it is not a time or is past the longest allowed moment.
 */
export function parseVideoTime(value: string): number | null {
  const text = value.trim().toLowerCase();
  let seconds: number | null = null;
  if (/^\d{1,6}$/.test(text)) {
    seconds = Number(text);
  } else if (/^\d{1,3}(:[0-5]?\d){1,2}$/.test(text)) {
    seconds = text.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
  } else {
    const match = /^(?:(\d{1,3})h)?(?:(\d{1,4})m)?(?:(\d{1,6})s)?$/.exec(text);
    if (match && (match[1] || match[2] || match[3])) {
      seconds =
        Number(match[1] ?? 0) * 3600 +
        Number(match[2] ?? 0) * 60 +
        Number(match[3] ?? 0);
    }
  }
  return seconds !== null && seconds <= MAX_VIDEO_SECONDS ? seconds : null;
}
