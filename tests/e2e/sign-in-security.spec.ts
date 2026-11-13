import { expect, test } from "@playwright/test";
import { totpFromUri } from "../helpers/auth-harness";
import {
  DEFAULT_PASSWORD,
  hydrated,
  registerAndVerify,
  uniqueEmail,
} from "./helpers";

// Passkeys are covered by the software-authenticator suites: this harness
// serves the app from 127.0.0.1, and browsers refuse IP addresses as WebAuthn
// relying-party IDs.
test("authenticator-app two-factor gates password sign-in", async ({
  page,
  browser,
  baseURL,
}) => {
  const email = uniqueEmail("two-factor");
  await registerAndVerify(page, email);

  await page.goto("/settings/security");
  await (
    await hydrated(page.getByLabel("Password to confirm"))
  ).fill(DEFAULT_PASSWORD);
  await page.getByRole("button", { name: "Set up two-factor" }).click();
  const setupKey = await page.getByLabel("Setup key").inputValue();
  expect(setupKey).toMatch(/^[A-Z2-7]+=*$/);
  const totpURI = `otpauth://totp/Memoria?secret=${setupKey}`;

  await page.getByLabel("Authentication code").fill(totpFromUri(totpURI));
  await page.getByRole("button", { name: "Turn on two-factor" }).click();
  await expect(page.getByTestId("backup-codes")).toBeVisible();
  const backupCodes = (await page.getByTestId("backup-codes").innerText())
    .split("\n")
    .map((code) => code.trim())
    .filter(Boolean);
  expect(backupCodes.length).toBeGreaterThan(0);

  // A new browser needs the password and then a code.
  const context = await browser.newContext({ baseURL });
  const fresh = await context.newPage();
  await fresh.goto("/auth/login");
  await fresh.getByLabel("Email").fill(email);
  await fresh.getByLabel("Password", { exact: true }).fill(DEFAULT_PASSWORD);
  await fresh.getByRole("button", { name: "Sign in" }).click();
  await expect(fresh.getByLabel("Authentication code")).toBeVisible();
  expect(
    (await context.cookies()).some(
      (cookie) => cookie.name === "memoria.session_token",
    ),
  ).toBe(false);

  await fresh.getByLabel("Authentication code").fill(totpFromUri(totpURI));
  await fresh.getByRole("button", { name: "Verify" }).click();
  await expect(fresh).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 15_000 });
  await context.close();

  // A backup code works once in place of the authenticator.
  const backupContext = await browser.newContext({ baseURL });
  const backupPage = await backupContext.newPage();
  await backupPage.goto("/auth/login");
  await backupPage.getByLabel("Email").fill(email);
  await backupPage
    .getByLabel("Password", { exact: true })
    .fill(DEFAULT_PASSWORD);
  await backupPage.getByRole("button", { name: "Sign in" }).click();
  await backupPage
    .getByRole("button", { name: "Use a backup code instead" })
    .click();
  await backupPage.getByLabel("Backup code").fill(backupCodes[0]);
  await backupPage.getByRole("button", { name: "Verify" }).click();
  await expect(backupPage).toHaveURL(/\/dashboard(?:\?|$)/, {
    timeout: 15_000,
  });
  await backupContext.close();
});
