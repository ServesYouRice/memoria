// Memoria browser button, background script (IMP-093): the right-click
// "Save to Memoria" entry and the keyboard shortcut. Both save to the canvas
// last chosen in the popup (the Inbox by default) and report the result on
// the toolbar button; the popup shows it in full the next time it opens.
import {
  clipOutcome,
  isSavableUrl,
  MENU_ID,
  normalizeServerUrl,
  outcomeMessage,
  pageFromMenuClick,
  SAVE_PAGE_COMMAND,
  sendClip,
} from "./lib.js";

const ext = globalThis.browser ?? globalThis.chrome;

async function createMenu() {
  await ext.contextMenus.removeAll();
  ext.contextMenus.create({
    id: MENU_ID,
    title: "Save to Memoria",
    contexts: ["page", "link", "selection"],
  });
}

async function report(result) {
  await ext.storage.local.set({ lastResult: { ...result, at: Date.now() } });
  const text = result.error ? "!" : result.saved ? "✓" : "=";
  await ext.action.setBadgeText({ text });
  await ext.action.setBadgeBackgroundColor({
    color: result.error ? "#b42318" : "#4f46e5",
  });
  await ext.action.setTitle({
    title: result.error
      ? `Memoria: ${result.error}`
      : `Memoria: ${result.message} Open the button to see it.`,
  });
}

/** Save one page to the last chosen canvas and show the result. */
export async function savePageInBackground(page) {
  const title = page.title || page.url;
  const stored = await ext.storage.local.get([
    "serverUrl",
    "apiKey",
    "lastCanvasId",
    "lastCanvasName",
  ]);
  if (!stored.serverUrl || !stored.apiKey) {
    await report({ title, error: "Open the Memoria button to connect first." });
    return;
  }
  if (!isSavableUrl(page.url)) {
    await report({ title, error: "Only web pages can be saved." });
    return;
  }
  try {
    const serverUrl = normalizeServerUrl(stored.serverUrl);
    const withCanvas = { ...page, canvasId: stored.lastCanvasId || "" };
    const body = await sendClip({
      serverUrl,
      apiKey: stored.apiKey,
      page: withCanvas,
    });
    const outcome = clipOutcome(
      serverUrl,
      body,
      withCanvas,
      withCanvas.canvasId ? stored.lastCanvasName : "",
    );
    await report({ ...outcome, title, message: outcomeMessage(outcome) });
  } catch (error) {
    await report({ title, error: error.message });
  }
}

// Selected text of the active tab, read only because the person pressed the
// shortcut (which grants activeTab for that tab).
async function selectionIn(tabId) {
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

ext.runtime.onInstalled.addListener(() => void createMenu());
ext.runtime.onStartup?.addListener(() => void createMenu());

ext.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  void savePageInBackground(pageFromMenuClick(info, tab));
});

ext.commands.onCommand.addListener(async (command, tab) => {
  if (command !== SAVE_PAGE_COMMAND) return;
  const active =
    tab ?? (await ext.tabs.query({ active: true, currentWindow: true }))[0];
  if (!active) return;
  await savePageInBackground({
    url: active.url,
    title: active.title,
    selection: await selectionIn(active.id),
  });
});
