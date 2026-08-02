import { expect, test } from "@playwright/test";
import {
  capturedLink,
  createCanvas,
  createNote,
  registerAndVerify,
  uniqueEmail,
  waitForCapturedMessage,
} from "./helpers";

test("committed collaboration events merge and tombstone across two sessions", async ({
  page,
  browser,
  baseURL,
}) => {
  const ownerEmail = uniqueEmail("owner");
  const collaboratorEmail = uniqueEmail("collaborator");
  await registerAndVerify(page, ownerEmail);

  const collaboratorContext = await browser.newContext({ baseURL });
  const collaboratorPage = await collaboratorContext.newPage();
  await registerAndVerify(collaboratorPage, collaboratorEmail);

  const canvas = await createCanvas(page, "Live Recovery Canvas");
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

  await page.goto(`/canvas/${canvas.id}`);
  await collaboratorPage.goto(`/canvas/${canvas.id}`);
  const ownerItems = page.getByRole("region", {
    name: `Items on ${canvas.name}`,
  });
  await expect(ownerItems).toContainText("This canvas has no items yet");
  await expect(page.getByText("Live", { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  const item = await createNote(
    collaboratorPage,
    canvas.id,
    "Committed event reached owner",
  );
  await expect(ownerItems).toContainText("Committed event reached owner", {
    timeout: 20_000,
  });

  const deleteResponse = await collaboratorPage.request.delete(
    `/api/v1/canvas-items/${item.id}`,
    { data: { version: item.version } },
  );
  expect(deleteResponse.status()).toBe(200);
  await expect(ownerItems).not.toContainText("Committed event reached owner", {
    timeout: 20_000,
  });

  await collaboratorContext.close();
});
