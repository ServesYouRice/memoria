import { expect, test } from "@playwright/test";
import {
  createCanvas,
  DEFAULT_PASSWORD,
  registerAndVerify,
  uniqueEmail,
} from "./helpers";

test("account export and deletion remove durable and public data", async ({
  page,
  browser,
  baseURL,
}) => {
  const email = uniqueEmail("account-delete");
  await registerAndVerify(page, email);
  const canvas = await createCanvas(page, "Delete Cascade Canvas");
  const publicResponse = await page.request.post(
    `/api/v1/canvases/${canvas.id}/public`,
  );
  expect(publicResponse.status()).toBe(200);
  const { shareUrl } = (await publicResponse.json()) as { shareUrl: string };
  const shareToken = new URL(shareUrl).pathname.split("/").at(-1);
  expect(shareToken).toBeTruthy();

  await page.goto("/settings");
  const exportPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download account data" }).click();
  const exportDownload = await exportPromise;
  expect(exportDownload.suggestedFilename()).toMatch(
    /^memoria-account-\d{4}-\d{2}-\d{2}\.json$/,
  );

  await page.getByRole("button", { name: "Delete account" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete account" });
  await dialog.getByLabel("Password", { exact: true }).fill(DEFAULT_PASSWORD);
  await dialog.getByLabel("Confirmation").fill("DELETE");
  await dialog.getByRole("button", { name: "Delete account" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });

  const anonymousContext = await browser.newContext({ baseURL });
  const anonymousPage = await anonymousContext.newPage();
  await expect
    .poll(
      async () =>
        (
          await anonymousPage.request.get(`/api/v1/share/${shareToken}`)
        ).status(),
      { timeout: 15_000 },
    )
    .toBe(404);

  await anonymousPage.goto("/auth/login");
  await anonymousPage.getByLabel("Email").fill(email);
  await anonymousPage
    .getByLabel("Password", { exact: true })
    .fill(DEFAULT_PASSWORD);
  await anonymousPage.getByRole("button", { name: "Sign in" }).click();
  await expect(
    anonymousPage.getByRole("alert").filter({ hasText: /invalid/i }),
  ).toBeVisible();
  await anonymousContext.close();
});
