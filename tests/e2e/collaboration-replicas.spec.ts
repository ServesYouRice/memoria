/**
 * IMP-043: the E2E stack runs two realtime replicas behind the gateway. Two
 * browsers whose sockets land on different replicas still see each other's
 * presence and edits, and the stored rows agree.
 */
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  capturedLink,
  createCanvas,
  createNote,
  registerAndVerify,
  uniqueEmail,
  waitForCapturedMessage,
} from "./helpers";

const REPLICA_HEALTH = ["http://127.0.0.1:3311", "http://127.0.0.1:3312"];
const REPLICA_HEADER = "X-Memoria-E2E-Replica";

interface CanvasCounts {
  sync: number;
  presence: number;
}

async function replicaCounts(
  request: APIRequestContext,
  canvasId: string,
): Promise<CanvasCounts[]> {
  return Promise.all(
    REPLICA_HEALTH.map(async (base) => {
      const response = await request.get(`${base}/health?canvas=${canvasId}`);
      expect(response.ok()).toBe(true);
      const body = (await response.json()) as { canvas: CanvasCounts };
      return body.canvas;
    }),
  );
}

function itemList(page: Page, canvasName: string) {
  return page.getByRole("region", { name: `Items on ${canvasName}` });
}

function presenceAvatars(page: Page) {
  return page.locator(".MuiAvatarGroup-root .MuiAvatar-root");
}

/**
 * Reopen the collaborator's canvas with different replica keys until each
 * replica serves exactly one browser's document and presence sockets.
 */
async function splitAcrossReplicas(
  context: BrowserContext,
  page: Page,
  request: APIRequestContext,
  canvas: { id: string; name: string },
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await context.setExtraHTTPHeaders({
      [REPLICA_HEADER]: `collaborator-${attempt}`,
    });
    await page.goto(`/canvas/${canvas.id}`);
    await expect(itemList(page, canvas.name)).toBeVisible();
    let counts: CanvasCounts[] = [];
    await expect
      .poll(
        async () => {
          counts = await replicaCounts(request, canvas.id);
          return counts.reduce(
            (total, entry) => total + entry.sync + entry.presence,
            0,
          );
        },
        { timeout: 20_000 },
      )
      .toBe(4);
    if (counts.every((entry) => entry.sync === 1 && entry.presence === 1))
      return;
  }
  throw new Error("Could not place the two browsers on different replicas");
}

test("browsers on different realtime replicas see each other", async ({
  page,
  browser,
  baseURL,
}) => {
  const ownerEmail = uniqueEmail("replica-owner");
  const collaboratorEmail = uniqueEmail("replica-collaborator");
  await page.context().setExtraHTTPHeaders({ [REPLICA_HEADER]: "owner" });
  await registerAndVerify(page, ownerEmail);
  const collaboratorContext = await browser.newContext({ baseURL });
  const collaboratorPage = await collaboratorContext.newPage();
  await registerAndVerify(collaboratorPage, collaboratorEmail);

  const canvas = await createCanvas(page, "Replica Canvas");
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
  const note = await createNote(page, canvas.id, "Replica note");

  await page.goto(`/canvas/${canvas.id}`);
  await expect(itemList(page, canvas.name)).toContainText("Replica note");
  await splitAcrossReplicas(
    collaboratorContext,
    collaboratorPage,
    page.request,
    canvas,
  );

  // Presence crosses replicas: each browser shows both people.
  await expect(presenceAvatars(page)).toHaveCount(2, { timeout: 20_000 });
  await expect(presenceAvatars(collaboratorPage)).toHaveCount(2, {
    timeout: 20_000,
  });

  // An edit on one replica reaches the browser on the other.
  const row = itemList(collaboratorPage, canvas.name).getByLabel(
    "note: Replica note",
  );
  await row.focus();
  await row.press("Enter");
  const dialog = collaboratorPage.getByRole("dialog", { name: "Edit Note" });
  await expect(dialog.getByText("Changes save as you type")).toBeVisible({
    timeout: 20_000,
  });
  const editor = dialog.locator(".ProseMirror");
  await editor.click();
  await editor.press("Control+End");
  await editor.pressSequentially(" from replica two", { delay: 20 });

  const edited = "Replica note from replica two";
  await expect(itemList(page, canvas.name)).toContainText(edited, {
    timeout: 20_000,
  });
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/v1/canvas-items/${note.id}`,
        );
        if (!response.ok()) return null;
        const item = (await response.json()) as {
          content: { plainText?: string };
        };
        return item.content.plainText;
      },
      { timeout: 20_000, intervals: [250, 500, 1000] },
    )
    .toBe(edited);

  await collaboratorContext.close();
});
