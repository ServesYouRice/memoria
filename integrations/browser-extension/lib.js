// Pure helpers for the Memoria tab saver popup. No extension APIs here, so the
// unit tests can import this file directly.

/** The batch endpoint accepts at most this many links per request. */
export const MAX_LINKS_PER_BATCH = 100;
export const BATCH_PATH = "/api/v1/extensions/clip/batch";

/** Only ordinary web pages can be saved as links. */
export function isWebUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

/**
 * Whether a tab is ticked when the popup opens: normal web tabs are, pinned
 * tabs and browser pages (chrome://, about:, edge://, extension pages) are not.
 */
export function isPreselected(tab) {
  return !tab.pinned && isWebUrl(tab.url);
}

/**
 * Normalize what the person pasted as their Memoria address to an origin
 * ("memoria.example.com" -> "https://memoria.example.com"). Throws on input
 * that is not an http(s) address.
 */
export function normalizeServerUrl(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) throw new Error("Enter your Memoria address.");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error("That does not look like a web address.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("The Memoria address must start with https://.");
  }
  return parsed.origin;
}

/** Host-permission pattern for the Memoria origin. */
export function originPattern(serverUrl) {
  return `${normalizeServerUrl(serverUrl)}/*`;
}

export function isApiKey(value) {
  return /^mk_[A-Za-z0-9_-]{20,}$/.test(String(value || "").trim());
}

/** Split tabs into request-sized groups. */
export function chunk(items, size = MAX_LINKS_PER_BATCH) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

/**
 * Request body for one batch of tabs. Tabs already saved in Memoria are not
 * saved again; the response lists them under `duplicates`.
 */
export function buildBatchBody(tabs, note, idempotencyKey) {
  const trimmedNote = String(note || "").trim();
  return {
    idempotencyKey,
    skipDuplicates: true,
    links: tabs.map((tab) => ({
      url: tab.url,
      ...(tab.title ? { title: String(tab.title).slice(0, 500) } : {}),
    })),
    ...(trimmedNote ? { note: trimmedNote } : {}),
  };
}

/** Readable message from a problem+json (or other) error response. */
export async function readError(response) {
  let detail = "";
  try {
    const body = await response.json();
    detail =
      (Array.isArray(body?.errors) && body.errors[0]?.message) ||
      body?.detail ||
      body?.title ||
      body?.error ||
      "";
  } catch {
    // Not JSON; fall back to the status text below.
  }
  if (response.status === 401) {
    return "Memoria did not accept the API key. Check it in the extension settings.";
  }
  return detail
    ? `Memoria could not save the tabs: ${String(detail).replace(/[.!?]?$/, ".")}`
    : `Memoria could not save the tabs (HTTP ${response.status}).`;
}

/**
 * Send one batch. Resolves with the server's confirmation
 * ({ batchId, canvasId, itemIds, replayed, duplicates }) and rejects with a
 * readable Error otherwise, so the caller only closes tabs after a confirmed
 * save. A tab counts as confirmed when it was saved or was already saved.
 */
export async function sendBatch({
  serverUrl,
  apiKey,
  tabs,
  note,
  idempotencyKey,
  fetchImpl = fetch,
}) {
  let response;
  try {
    response = await fetchImpl(
      `${normalizeServerUrl(serverUrl)}${BATCH_PATH}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": String(apiKey).trim(),
        },
        body: JSON.stringify(buildBatchBody(tabs, note, idempotencyKey)),
      },
    );
  } catch {
    throw new Error(
      "Could not reach Memoria. Check the address and your connection.",
    );
  }
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const body = await response.json();
  const alreadySaved = alreadySavedLinks(body).length;
  if (
    !Array.isArray(body?.itemIds) ||
    body.itemIds.length + alreadySaved !== tabs.length
  ) {
    throw new Error("Memoria answered, but did not confirm every tab.");
  }
  return body;
}

/**
 * Links of a batch response that were already in Memoria and so were not
 * saved again, each with the existing copy to open.
 */
export function alreadySavedLinks(body) {
  if (!Array.isArray(body?.duplicates)) return [];
  return body.duplicates.filter(
    (entry) =>
      entry &&
      entry.savedItemId === null &&
      Array.isArray(entry.existing) &&
      entry.existing.length > 0,
  );
}

/** Address of the existing copy of a link in the Memoria app. */
export function existingLinkUrl(serverUrl, existing) {
  const path = String(existing?.path || "");
  if (!path.startsWith("/canvas/")) return null;
  return `${normalizeServerUrl(serverUrl)}${path}`;
}

/** Stable fingerprint of what would be sent, to reuse keys on retry. */
export function selectionSignature(tabs, note) {
  return JSON.stringify([
    tabs.map((tab) => [tab.url, tab.title || ""]),
    String(note || "").trim(),
  ]);
}
