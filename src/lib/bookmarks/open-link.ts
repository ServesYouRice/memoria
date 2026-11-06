"use client";

/** Only web links are opened; anything else stays put. */
export function openableUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * IMP-070: tells the server the owner opened a saved link, so the weekly
 * recap does not call it stale. Best effort; opening never waits on it.
 */
export function recordLinkOpened(itemId: string) {
  void fetch(`/api/v1/items/${encodeURIComponent(itemId)}/opened`, {
    method: "POST",
    keepalive: true,
  }).catch(() => {});
}

/** Opens a saved link in a new tab and records the open. */
export function openSavedLink(item: { id: string; url: unknown }) {
  const url = openableUrl(item.url);
  if (!url) return false;
  window.open(url, "_blank", "noopener,noreferrer");
  recordLinkOpened(item.id);
  return true;
}
