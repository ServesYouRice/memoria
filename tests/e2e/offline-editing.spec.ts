/**
 * IMP-045: an editor keeps working on an open canvas without a network. The
 * edits are kept on the device (IndexedDB), survive a reload while offline
 * (the service worker serves the canvas page shell), sync through the sync
 * server once the network is back, and leave the device on sign-out.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  createCanvas,
  createNote,
  registerAndVerify,
  uniqueEmail,
} from "./helpers";

const SHELL_CACHE = "memoria-canvas-shells-v1";

function itemList(page: Page, canvasName: string) {
  return page.getByRole("region", { name: `Items on ${canvasName}` });
}

/** The device copy record of a canvas, without creating the database. */
function deviceCopy(page: Page, canvasId: string) {
  return page.evaluate(async (id) => {
    const databases = await indexedDB.databases();
    if (!databases.some((entry) => entry.name === "memoria-offline"))
      return null;
    return new Promise<{ writable: boolean; unsavedChanges: number } | null>(
      (resolve, reject) => {
        const request = indexedDB.open("memoria-offline");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("documents")) {
            db.close();
            resolve(null);
            return;
          }
          const records = db
            .transaction("documents")
            .objectStore("documents")
            .getAll();
          records.onsuccess = () => {
            db.close();
            const record = (
              records.result as Array<{
                canvasId: string;
                writable: boolean;
                unsavedChanges: number;
              }>
            ).find((entry) => entry.canvasId === id);
            resolve(
              record
                ? {
                    writable: record.writable,
                    unsavedChanges: record.unsavedChanges,
                  }
                : null,
            );
          };
          records.onerror = () => reject(records.error);
        };
      },
    );
  }, canvasId);
}

function shellCached(page: Page) {
  return page.evaluate(async (cacheName) => {
    const cache = await caches.open(cacheName);
    return Boolean(await cache.match(location.pathname));
  }, SHELL_CACHE);
}

test("an editor keeps editing offline, reloads, and syncs on reconnect", async ({
  page,
  context,
}) => {
  const email = uniqueEmail("offline-editor");
  await registerAndVerify(page, email);
  const canvas = await createCanvas(page, "Offline Canvas");
  const note = await createNote(page, canvas.id, "Kept on this device");

  await page.goto(`/canvas/${canvas.id}`);
  // The service worker controls the page from its second load on; the page
  // then keeps its shell for opening offline.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  const items = itemList(page, canvas.name);
  await expect(items).toContainText("Kept on this device");
  await expect.poll(() => shellCached(page), { timeout: 15_000 }).toBe(true);
  await expect
    .poll(() => deviceCopy(page, canvas.id), { timeout: 15_000 })
    .toMatchObject({ writable: true, unsavedChanges: 0 });

  // The network goes away; editing goes on.
  await context.setOffline(true);
  const status = page.getByLabel("Save status");
  const row = items.getByLabel("note: Kept on this device");
  await row.focus();
  await row.press("ArrowRight");
  await expect(status).toHaveText("Offline · 1 unsaved change", {
    timeout: 15_000,
  });
  await expect
    .poll(() => deviceCopy(page, canvas.id))
    .toMatchObject({ unsavedChanges: 1 });

  // A reload without a network opens the canvas from the device copy, edits
  // included, and editing continues.
  await page.reload();
  await expect(items).toContainText("Kept on this device", {
    timeout: 20_000,
  });
  await expect(status).toHaveText("Offline · 1 unsaved change");
  const reloadedRow = items.getByLabel("note: Kept on this device");
  await reloadedRow.focus();
  await reloadedRow.press("ArrowRight");
  await expect(status).toHaveText("Offline · 2 unsaved changes");

  // Back online: the edits reach the server through the sync server.
  await context.setOffline(false);
  await expect(status).toHaveText("Saved", { timeout: 30_000 });
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/v1/canvas-items/${note.id}`,
        );
        if (!response.ok()) return null;
        return ((await response.json()) as { positionX: number }).positionX;
      },
      { timeout: 20_000, intervals: [250, 500, 1000] },
    )
    .toBe(122);
  await expect
    .poll(() => deviceCopy(page, canvas.id))
    .toMatchObject({ unsavedChanges: 0 });

  // Signing out takes the device copies and the cached shells with it.
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).not.toHaveURL(/\/dashboard/, { timeout: 15_000 });
  expect(await deviceCopy(page, canvas.id)).toBeNull();
  expect(
    await page.evaluate((cacheName) => caches.has(cacheName), SHELL_CACHE),
  ).toBe(false);
});
