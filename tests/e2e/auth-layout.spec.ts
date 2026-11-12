import { expect, test } from "@playwright/test";

/**
 * IMP-082: the sign-in and sign-up form gets at least half the desktop width,
 * fields are finger-sized, the passkey button is as easy to spot as the
 * password one, and on a phone the side panel shrinks to the logo.
 */

for (const path of ["/auth/login", "/auth/register"]) {
  test(`form column takes at least half the width on ${path}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path);
    const form = page.locator("form").first();
    await expect(form).toBeVisible();

    const column = form.locator(
      "xpath=ancestor::div[contains(@class,'MuiContainer-root')]/..",
    );
    const box = await column.boundingBox();
    // The split row, i.e. the page minus any scrollbar.
    const pageWidth = (await column.locator("xpath=..").boundingBox())!.width;
    expect(box!.width).toBeGreaterThanOrEqual(pageWidth / 2 - 1);

    for (const input of await form.locator("input:visible").all()) {
      const type = await input.getAttribute("type");
      if (type === "checkbox") continue;
      const field = input.locator("xpath=ancestor::div[1]");
      expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });
}

test("passkey sign-in sits beside the password option", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/auth/login");
  const passkey = page.getByRole("button", { name: "Use a passkey" });
  const password = page.getByRole("button", { name: "Sign in", exact: true });
  await expect(passkey).toBeVisible();
  const [passkeyBox, passwordBox] = await Promise.all([
    passkey.boundingBox(),
    password.boundingBox(),
  ]);
  expect(passkeyBox!.width).toBe(passwordBox!.width);
  // Outlined and filled buttons differ by their 1px border at most.
  expect(
    Math.abs(passkeyBox!.height - passwordBox!.height),
  ).toBeLessThanOrEqual(2);
  // Shown above the email form, so it is seen first.
  expect(passkeyBox!.y).toBeLessThan(passwordBox!.y);
});

test("on a phone only the logo stays from the side panel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/auth/login");
  await expect(page.locator("form").first()).toBeVisible();
  await expect(page.locator('img[src*="canvas-dark"]')).toBeHidden();
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
