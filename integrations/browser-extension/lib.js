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
 * Longest URL the server accepts. Keep in step with MAX_URL_LENGTH in
 * src/lib/constants.ts: one longer URL makes the server reject a whole batch.
 */
export const MAX_URL_LENGTH = 2048;

/** A web page whose address the server will accept, sent unchanged. */
export function isSavableUrl(url) {
  return isWebUrl(url) && url.length <= MAX_URL_LENGTH;
}

/**
 * Whether a tab is ticked when the popup opens: normal web tabs are; pinned
 * tabs, browser pages (chrome://, about:, edge://, extension pages) and pages
 * with an address too long to save are not.
 */
export function isPreselected(tab) {
  return !tab.pinned && isSavableUrl(tab.url);
}

/**
 * Loopback development hosts, the only ones plain http:// may reach:
 * localhost (and *.localhost), 127.0.0.0/8 and [::1]. URL.hostname keeps the
 * brackets around IPv6 addresses.
 */
export function isLoopbackHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "[::1]") return true;
  return /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(host);
}

/**
 * Normalize what the person pasted as their Memoria address to an origin
 * ("memoria.example.com" -> "https://memoria.example.com"). Throws on input
 * that is not an https address, or a plain http address of a loopback host:
 * the API key must never cross the network in cleartext.
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
  if (parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname)) {
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

/**
 * Readable message from a problem+json (or other) error response. With the
 * submitted `tabs`, a validation error on `links.N.…` names that tab.
 */
export async function readError(response, tabs = []) {
  let detail = "";
  let tabName = "";
  try {
    const body = await response.json();
    const field = Array.isArray(body?.errors) ? body.errors[0]?.field : null;
    const index = /^links\.(\d+)(?:\.|$)/.exec(String(field ?? ""))?.[1];
    const tab = index === undefined ? undefined : tabs[Number(index)];
    if (tab) tabName = String(tab.title || tab.url || "");
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
  const message = detail
    ? `Memoria could not save the tabs: ${String(detail).replace(/[.!?]?$/, ".")}`
    : `Memoria could not save the tabs (HTTP ${response.status}).`;
  return tabName ? `${message} Rejected tab: ${tabName}` : message;
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
  // Validate the address before the request, so an address that may not
  // carry the key (plain http to a remote host) never reaches fetch.
  const url = `${normalizeServerUrl(serverUrl)}${BATCH_PATH}`;
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": String(apiKey).trim(),
      },
      body: JSON.stringify(buildBatchBody(tabs, note, idempotencyKey)),
    });
  } catch {
    throw new Error(
      "Could not reach Memoria. Check the address and your connection.",
    );
  }
  if (!response.ok) {
    throw new Error(await readError(response, tabs));
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

function hasFragment(url) {
  const hash = String(url).indexOf("#");
  return hash !== -1 && hash < String(url).length - 1;
}

/**
 * Ids of submitted tabs the server reported as already saved without proof
 * that the saved copy is the same page. Duplicate matching ignores the URL
 * fragment, which on hash-routed apps names a different page
 * (#/document/A vs #/document/B), so such a tab was never saved and must stay
 * open. A duplicate counts as the same page when one existing copy has the
 * tab's exact URL; when the response names no URL, only when the tab's URL
 * has no fragment.
 */
export function unconfirmedDuplicateTabIds(tabs, body) {
  const unconfirmed = [];
  for (const entry of alreadySavedLinks(body)) {
    const tab =
      tabs[entry.index]?.url === entry.url
        ? tabs[entry.index]
        : tabs.find((candidate) => candidate.url === entry.url);
    if (!tab) continue;
    const savedUrls = entry.existing
      .map((existing) => existing?.url)
      .filter((url) => typeof url === "string");
    const samePage =
      savedUrls.length > 0
        ? savedUrls.includes(tab.url)
        : !hasFragment(tab.url);
    if (!samePage) unconfirmed.push(tab.id);
  }
  return unconfirmed;
}

/** Address of the existing copy of a link in the Memoria app. */
export function existingLinkUrl(serverUrl, existing) {
  const path = String(existing?.path || "");
  if (!path.startsWith("/canvas/")) return null;
  return `${normalizeServerUrl(serverUrl)}${path}`;
}

/**
 * Which submitted tabs may close after the server confirmed them: those that
 * still exist and still show the submitted URL (and, when the browser reports
 * a navigation in progress, whose pendingUrl is that URL too). `current` maps
 * a tab id to its fresh record, or to null when the tab is gone.
 */
export function closableTabIds(submitted, current) {
  const closable = [];
  const changed = [];
  for (const tab of submitted) {
    const now = current.get(tab.id);
    if (
      now &&
      now.url === tab.url &&
      (now.pendingUrl === undefined ||
        now.pendingUrl === "" ||
        now.pendingUrl === tab.url)
    ) {
      closable.push(tab.id);
    } else {
      changed.push(tab.id);
    }
  }
  return { closable, changed };
}

/** Stable fingerprint of what would be sent, to reuse keys on retry. */
export function selectionSignature(tabs, note) {
  return JSON.stringify([
    tabs.map((tab) => [tab.url, tab.title || ""]),
    String(note || "").trim(),
  ]);
}
