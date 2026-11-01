/**
 * IMP-042: two browsers edit the same note at once through the collaborative
 * document. Their edits merge, every browser converges on the same text, and
 * the HTTP API (the rows search, export and agents read) shows the result.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  capturedLink,
  createCanvas,
  createNote,
  registerAndVerify,
  uniqueEmail,
  waitForCapturedMessage,
} from "./helpers";

const LIVE_EDITING = "Changes save as you type";

function itemList(page: Page, canvasName: string) {
  return page.getByRole("region", { name: `Items on ${canvasName}` });
}

async function openSharedNote(page: Page, canvasName: string, text: string) {
  const row = itemList(page, canvasName).getByLabel(`note: ${text}`);
  await row.focus();
  await row.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Edit Note" });
  // The dialog edits the shared text once the canvas document has synced.
  await expect(dialog.getByText(LIVE_EDITING)).toBeVisible({
    timeout: 20_000,
  });
  return dialog.locator(".ProseMirror");
}

test("two browsers co-edit the same note and converge", async ({
  page,
  browser,
  baseURL,
}) => {
  const ownerEmail = uniqueEmail("coedit-owner");
  const collaboratorEmail = uniqueEmail("coedit-collaborator");
  await registerAndVerify(page, ownerEmail);
  const collaboratorContext = await browser.newContext({ baseURL });
  const collaboratorPage = await collaboratorContext.newPage();
  await registerAndVerify(collaboratorPage, collaboratorEmail);

  const canvas = await createCanvas(page, "Co-editing Canvas");
  const invitationResponse = await page.request.post(
    `/api/v1/canvases/${canvas.id}/share`,
    { data: { email: collaboratorEmail, role: "EDIT" } },
  );
  expect(invitationResponse.status()).toBe(202);
  const invitation = await waitForCapturedMessage(
    page.request,
    collaboratorEmail,
    "invited you to a Memoria canvas",
  );
  const invitationUrl = new URL(
    capturedLink(invitation, "/share-invitations/"),
  );
  const acceptResponse = await collaboratorPage.request.post(
    `/api/v1${invitationUrl.pathname}${invitationUrl.search}`,
    { data: { action: "accept" } },
  );
  expect(acceptResponse.status()).toBe(200);

  // A note written through the HTTP API before anyone opened the canvas: the
  // sync server migrates the canvas into a document on first open.
  const note = await createNote(page, canvas.id, "Shared note");

  await page.goto(`/canvas/${canvas.id}`);
  await collaboratorPage.goto(`/canvas/${canvas.id}`);
  await expect(itemList(page, canvas.name)).toContainText("Shared note");
  await expect(itemList(collaboratorPage, canvas.name)).toContainText(
    "Shared note",
  );

  const ownerEditor = await openSharedNote(page, canvas.name, "Shared note");

  // While the owner has the note open, the collaborator moves it.
  const collaboratorRow = itemList(collaboratorPage, canvas.name).getByLabel(
    "note: Shared note",
  );
  await collaboratorRow.focus();
  await collaboratorRow.press("ArrowRight");
  const collaboratorEditor = await openSharedNote(
    collaboratorPage,
    canvas.name,
    "Shared note",
  );

  // Both type into the same text at the same time.
  await ownerEditor.click();
  await ownerEditor.press("Control+End");
  await collaboratorEditor.click();
  await collaboratorEditor.press("Control+Home");
  await Promise.all([
    ownerEditor.pressSequentially(" plus owner", { delay: 20 }),
    collaboratorEditor.pressSequentially("Collaborator says: ", { delay: 20 }),
  ]);

  const merged = "Collaborator says: Shared note plus owner";
  await expect(ownerEditor).toHaveText(merged, { timeout: 20_000 });
  await expect(collaboratorEditor).toHaveText(merged, { timeout: 20_000 });

  // The rows behind the HTTP API, search, export and agents caught up.
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/v1/canvas-items/${note.id}`,
        );
        if (!response.ok()) return null;
        const item = (await response.json()) as {
          positionX: number;
          content: { plainText?: string };
        };
        return { positionX: item.positionX, text: item.content.plainText };
      },
      { timeout: 20_000, intervals: [250, 500, 1000] },
    )
    .toEqual({ positionX: 121, text: merged });

  // A reload starts from the stored document and shows the same text.
  await collaboratorPage.keyboard.press("Escape");
  await collaboratorPage.reload();
  await expect(itemList(collaboratorPage, canvas.name)).toContainText(merged, {
    timeout: 20_000,
  });

  await collaboratorContext.close();
});
