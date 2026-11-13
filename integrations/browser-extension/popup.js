// Memoria browser button popup. Opens on "Save this page"; "Save all tabs" is
// the second view. Works with the promise-based WebExtension API in Chrome,
// Edge (`chrome.*`) and Firefox (`browser.*`).
import {
  alreadySavedLinks,
  chunk,
  clipOutcome,
  fetchCanvases,
  initialCanvasId,
  INBOX_NAME,
  outcomeMessage,
  sendClip,
  closableTabIds,
  existingLinkUrl,
  isApiKey,
  isPreselected,
  isSavableUrl,
  isWebUrl,
  normalizeServerUrl,
  originPattern,
  selectionSignature,
  unconfirmedDuplicateTabIds,
  sendBatch,
} from "./lib.js";

const ext = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);

let settings = null;
let tabs = [];
const selected = new Set();
// Idempotency keys for the current selection, kept in storage.local so a retry
// after a failed or lost response (even from a reopened popup) replays the
// same batches instead of saving the tabs twice.
let pending = {};
// True from the first line of save() until it finishes, so a second save can
// not start while one is in flight.
let saving = false;

function show(section) {
  $("setup").hidden = section !== "setup";
  $("page").hidden = section !== "page";
  $("main").hidden = section !== "main";
}

function setMessage(id, text) {
  $(id).textContent = text || "";
  $(id).hidden = !text;
}

// "You saved this already": list the tabs Memoria did not save again, each
// with a link to open the existing copy.
function renderDuplicates(entries) {
  const list = $("duplicate-list");
  list.replaceChildren();
  $("duplicates").hidden = entries.length === 0;
  for (const entry of entries) {
    const existing = entry.existing[0];
    const item = document.createElement("li");
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = existing.title || entry.url;
    title.title = entry.url;
    item.append(title);
    const href = existingLinkUrl(settings.serverUrl, existing);
    if (href) {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "link";
      open.textContent = existing.canvasName
        ? `Open in ${existing.canvasName}`
        : "Open existing";
      open.addEventListener("click", () => {
        void ext.tabs.create({ url: href, active: true });
      });
      item.append(open);
    }
    list.append(item);
  }
}

async function loadSettings() {
  const stored = await ext.storage.local.get(["serverUrl", "apiKey"]);
  return stored.serverUrl && stored.apiKey
    ? { serverUrl: stored.serverUrl, apiKey: stored.apiKey }
    : null;
}

function openSetup() {
  $("server-url").value = settings?.serverUrl ?? "";
  $("api-key").value = settings?.apiKey ?? "";
  $("setup-cancel").hidden = !settings;
  setMessage("setup-error", "");
  show("setup");
  $(settings ? "api-key" : "server-url").focus();
}

async function saveSetup(event) {
  event.preventDefault();
  setMessage("setup-error", "");
  let serverUrl;
  try {
    serverUrl = normalizeServerUrl($("server-url").value);
  } catch (error) {
    setMessage("setup-error", error.message);
    return;
  }
  const apiKey = $("api-key").value.trim();
  if (!isApiKey(apiKey)) {
    setMessage(
      "setup-error",
      "Paste the whole API key from Memoria (it starts with mk_).",
    );
    return;
  }

  // Ask for access to this one Memoria origin. This must be the first await
  // so the browser still sees the click that triggered it.
  let granted = false;
  try {
    granted = await ext.permissions.request({
      origins: [originPattern(serverUrl)],
    });
  } catch (error) {
    setMessage("setup-error", error.message);
    return;
  }
  if (!granted) {
    setMessage(
      "setup-error",
      "The extension needs permission to reach your Memoria address.",
    );
    return;
  }

  settings = { serverUrl, apiKey };
  await ext.storage.local.set(settings);
  await showPage();
}

// --- "Save this page" (IMP-093) ---

let currentTab = null;
let savingPage = false;
let existingUrl = null;
/** Results the background script stored are shown if this recent. */
const LAST_RESULT_MAX_AGE_MS = 10 * 60 * 1000;

function setExisting(url, label = "Open it") {
  existingUrl = url;
  $("open-existing").hidden = !url;
  $("open-existing").textContent = label;
}

function renderCanvasOptions(canvases, chosenId) {
  const select = $("canvas");
  const options = canvases.some((canvas) => canvas.name === INBOX_NAME)
    ? canvases
    : [{ id: "", name: INBOX_NAME }, ...canvases];
  select.replaceChildren(
    ...options.map((canvas) => {
      const option = document.createElement("option");
      option.value = canvas.id;
      option.textContent = canvas.name;
      return option;
    }),
  );
  select.value = chosenId;
}

async function loadCanvases() {
  const { lastCanvasId } = await ext.storage.local.get("lastCanvasId");
  let canvases = [];
  try {
    canvases = await fetchCanvases(settings);
  } catch {
    // Saving still works: the server picks the Inbox when no canvas is sent.
  }
  renderCanvasOptions(canvases, initialCanvasId(canvases, lastCanvasId));
}

// The page's selected text, read only when the person clicks save. The
// popup's activeTab grant covers this one tab; browser pages refuse it.
async function readSelection(tabId) {
  if (!ext.scripting?.executeScript) return "";
  try {
    const [result] = await ext.scripting.executeScript({
      target: { tabId },
      func: () => String(globalThis.getSelection?.() ?? ""),
    });
    return typeof result?.result === "string" ? result.result : "";
  } catch {
    return "";
  }
}

// A save the right-click menu or the keyboard shortcut made while the popup
// was closed: show it once, then clear the toolbar badge.
async function showLastResult() {
  const { lastResult } = await ext.storage.local.get("lastResult");
  if (!lastResult) return;
  await ext.storage.local.set({ lastResult: null });
  await ext.action?.setBadgeText?.({ text: "" });
  if (Date.now() - Number(lastResult.at || 0) > LAST_RESULT_MAX_AGE_MS) return;
  const prefix = lastResult.title ? `${lastResult.title}: ` : "";
  if (lastResult.error) {
    setMessage("page-error", `${prefix}${lastResult.error}`);
    return;
  }
  setMessage("page-status", `${prefix}${lastResult.message}`);
  setExisting(
    lastResult.openUrl || null,
    lastResult.saved ? "Open in Memoria" : "Open it",
  );
}

async function showPage() {
  [currentTab] = await ext.tabs.query({ active: true, currentWindow: true });
  const savable = isSavableUrl(currentTab?.url);
  $("page-title").textContent =
    currentTab?.title || currentTab?.url || "No page";
  $("page-url").textContent = currentTab?.url || "";
  setMessage(
    "page-error",
    savable
      ? ""
      : "This is a browser page, so it cannot be saved. You can still save the other tabs.",
  );
  setMessage("page-status", "");
  setExisting(null);
  $("save-page").disabled = !savable;
  show("page");
  await showLastResult();
  await loadCanvases();
}

async function savePage() {
  if (savingPage || !currentTab || !settings) return;
  savingPage = true;
  $("save-page").disabled = true;
  $("canvas").disabled = true;
  setMessage("page-error", "");
  setMessage("page-status", "Saving…");
  setExisting(null);
  try {
    const select = $("canvas");
    const canvasName = select.selectedOptions[0]?.textContent || INBOX_NAME;
    const page = {
      url: currentTab.url,
      title: currentTab.title,
      selection: await readSelection(currentTab.id),
      canvasId: select.value,
    };
    const body = await sendClip({ ...settings, page });
    const outcome = clipOutcome(settings.serverUrl, body, page, canvasName);
    setMessage("page-status", outcomeMessage(outcome));
    setExisting(outcome.openUrl, outcome.saved ? "Open in Memoria" : "Open it");
  } catch (error) {
    setMessage("page-status", "");
    setMessage("page-error", error.message);
  } finally {
    savingPage = false;
    $("save-page").disabled = false;
    $("canvas").disabled = false;
  }
}

function selectedTabs() {
  return tabs.filter((tab) => selected.has(tab.id));
}

function renderSelection() {
  const savable = tabs.filter((tab) => isSavableUrl(tab.url));
  const count = selected.size;
  $("selection-count").textContent = `${count} of ${tabs.length} tabs selected`;
  $("toggle-all").checked = count > 0 && count === savable.length;
  $("toggle-all").indeterminate = count > 0 && count < savable.length;
  $("toggle-all").disabled = saving || savable.length === 0;
  $("save").disabled = saving || count === 0;
  $("note").disabled = saving;
  $("open-settings").disabled = saving;
  $("show-page").disabled = saving;
  $("save").textContent =
    count === 1 ? "Save and close 1 tab" : `Save and close ${count} tabs`;
}

function renderTabs() {
  const list = $("tab-list");
  list.replaceChildren();
  for (const tab of tabs) {
    const savable = isSavableUrl(tab.url);
    const item = document.createElement("li");
    item.className = savable ? "" : "unsavable";
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.tabId = String(tab.id);
    checkbox.checked = selected.has(tab.id);
    checkbox.disabled = !savable || saving;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selected.add(tab.id);
      else selected.delete(tab.id);
      renderSelection();
    });
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = tab.title || tab.url || "Untitled tab";
    title.title = tab.url || "";
    label.append(checkbox, title);
    if (!savable || tab.pinned) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = savable
        ? "pinned"
        : isWebUrl(tab.url)
          ? "address too long"
          : "browser page";
      label.append(tag);
    }
    item.append(label);
    list.append(item);
  }
  renderSelection();
}

async function showTabs() {
  tabs = await ext.tabs.query({ currentWindow: true });
  selected.clear();
  for (const tab of tabs) {
    if (isPreselected(tab)) selected.add(tab.id);
  }
  setMessage("save-error", "");
  setMessage("save-status", "");
  renderDuplicates([]);
  renderTabs();
  show("main");
}

// One idempotency key per group of tabs, keyed by exactly what is sent.
async function batchesFor(chosen, note) {
  const groups = chunk(chosen).map((group) => {
    const signature = selectionSignature(group, note);
    pending[signature] ??= crypto.randomUUID();
    return { tabs: group, signature, idempotencyKey: pending[signature] };
  });
  await ext.storage.local.set({ pendingBatches: pending });
  return groups;
}

async function forgetBatch(signature) {
  delete pending[signature];
  await ext.storage.local.set({ pendingBatches: pending });
}

async function closeTabs(ids) {
  // Closing every tab would close the window (and this popup with it) before
  // the rest of the work is done, so leave a fresh tab behind.
  const remaining = tabs.filter((tab) => !ids.includes(tab.id));
  if (remaining.length === 0) {
    await ext.tabs.create({ active: true });
  }
  if (ids.length > 0) await ext.tabs.remove(ids);
  tabs = remaining;
  for (const id of ids) selected.delete(id);
}

// Fresh records of the given tabs, null for a tab that is gone.
async function currentTabs(ids) {
  const entries = await Promise.all(
    ids.map(async (id) => [id, await ext.tabs.get(id).catch(() => null)]),
  );
  return new Map(entries);
}

async function save() {
  if (saving) return;
  saving = true;
  renderSelection();
  try {
    await saveSelected();
  } finally {
    saving = false;
    renderTabs();
  }
}

async function saveSelected() {
  if (selected.size === 0 || !settings) return;
  // Submit what each tab shows now, not what it showed when the popup opened.
  const fresh = await currentTabs([...selected]);
  for (const [id, now] of fresh) {
    if (!now) selected.delete(id);
  }
  tabs = tabs
    .filter((tab) => !fresh.has(tab.id) || fresh.get(tab.id))
    .map((tab) => {
      const now = fresh.get(tab.id);
      return now ? { ...tab, url: now.url, title: now.title } : tab;
    });
  const chosen = selectedTabs().filter((tab) => isSavableUrl(tab.url));
  if (chosen.length === 0) return;
  const note = $("note").value;
  const groups = await batchesFor(chosen, note);

  setMessage("save-error", "");
  setMessage("save-status", "Saving…");
  renderDuplicates([]);
  let saved = 0;
  let changed = 0;
  let unconfirmed = 0;
  const duplicates = [];
  const changedText = () =>
    changed === 0
      ? ""
      : changed === 1
        ? " 1 tab changed page and was left open."
        : ` ${changed} tabs changed page and were left open.`;
  const unconfirmedText = () =>
    unconfirmed === 0
      ? ""
      : unconfirmed === 1
        ? " 1 tab matched a saved page at a different address and was left open."
        : ` ${unconfirmed} tabs matched a saved page at a different address and were left open.`;
  try {
    for (const group of groups) {
      const result = await sendBatch({
        serverUrl: settings.serverUrl,
        apiKey: settings.apiKey,
        tabs: group.tabs,
        note,
        idempotencyKey: group.idempotencyKey,
      });
      await forgetBatch(group.signature);
      // Only tabs the server confirmed (saved, or already saved), and that
      // still show the confirmed page, are closed.
      const decision = closableTabIds(
        group.tabs,
        await currentTabs(group.tabs.map((tab) => tab.id)),
      );
      // A duplicate matched without its URL fragment may be another page
      // that was never saved: keep it open.
      const keep = new Set(unconfirmedDuplicateTabIds(group.tabs, result));
      await closeTabs(decision.closable.filter((id) => !keep.has(id)));
      for (const id of decision.changed) selected.delete(id);
      changed += decision.changed.filter((id) => !keep.has(id)).length;
      unconfirmed += keep.size;
      const skipped = alreadySavedLinks(result);
      const keptUrls = new Set(
        group.tabs.filter((tab) => keep.has(tab.id)).map((tab) => tab.url),
      );
      duplicates.push(...skipped.filter((entry) => !keptUrls.has(entry.url)));
      saved += group.tabs.length - skipped.length;
    }
    $("note").value = "";
    // Re-read the window so tabs that changed page show what they show now.
    tabs = await ext.tabs.query({ currentWindow: true });
    renderTabs();
    renderDuplicates(duplicates);
    const savedText =
      saved === 1
        ? "Saved 1 tab to your Memoria Inbox."
        : `Saved ${saved} tabs to your Memoria Inbox.`;
    setMessage(
      "save-status",
      (duplicates.length === 0
        ? savedText
        : `${savedText} ${duplicates.length === 1 ? "1 tab was" : `${duplicates.length} tabs were`} already saved.`) +
        unconfirmedText() +
        changedText(),
    );
  } catch (error) {
    renderTabs();
    renderDuplicates(duplicates);
    setMessage(
      "save-status",
      (saved ? `Saved ${saved} tabs.` : "") + unconfirmedText() + changedText(),
    );
    setMessage(
      "save-error",
      `${error.message} The remaining tabs are still open.`,
    );
  }
}

async function start() {
  $("setup-form").addEventListener("submit", saveSetup);
  $("setup-cancel").addEventListener("click", () => show("page"));
  $("open-settings").addEventListener("click", openSetup);
  $("page-settings").addEventListener("click", openSetup);
  $("save-page").addEventListener("click", savePage);
  $("show-tabs").addEventListener("click", () => void showTabs());
  $("show-page").addEventListener("click", () => void showPage());
  $("canvas").addEventListener("change", (event) => {
    const select = event.target;
    void ext.storage.local.set({
      lastCanvasId: select.value,
      lastCanvasName: select.selectedOptions[0]?.textContent || INBOX_NAME,
    });
  });
  $("open-existing").addEventListener("click", () => {
    if (existingUrl) void ext.tabs.create({ url: existingUrl, active: true });
  });
  $("save").addEventListener("click", save);
  $("toggle-all").addEventListener("change", (event) => {
    selected.clear();
    if (event.target.checked) {
      for (const tab of tabs) if (isSavableUrl(tab.url)) selected.add(tab.id);
    }
    renderTabs();
  });

  settings = await loadSettings();
  pending =
    (await ext.storage.local.get("pendingBatches")).pendingBatches ?? {};
  if (!settings) {
    openSetup();
    return;
  }
  try {
    normalizeServerUrl(settings.serverUrl);
  } catch (error) {
    // A saved address this version no longer accepts (such as plain http to
    // a remote host): send the person to setup instead of using it.
    openSetup();
    setMessage("setup-error", error.message);
    return;
  }
  await showPage();
}

start().catch((error) => {
  show("page");
  setMessage("page-error", error.message);
});
