import { expect, test } from "@playwright/test";
import {
  capturedLink,
  DEFAULT_PASSWORD,
  registerAndVerify,
  signIn,
  uniqueEmail,
  waitForCapturedMessage,
} from "./helpers";

test("password reset revokes every existing production session", async ({
  page,
  browser,
  baseURL,
}) => {
  const email = uniqueEmail("password-reset");
  const newPassword = "Different-Quartz-Mountain-88!";
  await registerAndVerify(page, email);

  const secondContext = await browser.newContext({ baseURL });
  const secondPage = await secondContext.newPage();
  await signIn(secondPage, email);

  await page.goto("/auth/forgot-password");
  await page.getByLabel("Email Address").fill(email);
  await page.getByRole("button", { name: "Send Reset Instructions" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "If an account exists" }),
  ).toBeVisible();

  const message = await waitForCapturedMessage(
    page.request,
    email,
    "Reset Your Password",
  );
  const resetUrl = new URL(capturedLink(message, "/auth/reset-password"));
  const resetContext = await browser.newContext({ baseURL });
  const resetPage = await resetContext.newPage();
  await resetPage.goto(`${resetUrl.pathname}${resetUrl.search}`);
  await resetPage.getByLabel("New Password", { exact: true }).fill(newPassword);
  await resetPage
    .getByLabel("Confirm New Password", { exact: true })
    .fill(newPassword);
  await resetPage.getByRole("button", { name: "Reset Password" }).click();
  await expect(
    resetPage
      .getByRole("alert")
      .filter({ hasText: "Password reset successful" }),
  ).toBeVisible();

  await expect
    .poll(
      async () => (await secondPage.request.get("/api/v1/canvases")).status(),
      { timeout: 15_000 },
    )
    .toBe(401);

  await signIn(page, email, newPassword);
  await page.goto("/auth/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(DEFAULT_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /invalid/i }),
  ).toBeVisible();

  await secondContext.close();
  await resetContext.close();
});
