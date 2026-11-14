/**
 * IMP-105: an editor starts the timer and every open screen of the canvas
 * shows the same countdown within about a second; someone who opens the
 * canvas later sees the right time left.
 */
import { expect, test, type Page } from "@playwright/test";
import { createCanvas, registerAndVerify, uniqueEmail } from "./helpers";

function countdown(page: Page) {
  return page.getByRole("button", { name: /^Shared timer: .* left/ });
}

/** Seconds left on the countdown button, read from its "mm:ss". */
async function secondsLeft(page: Page): Promise<number> {
  const text = (await countdown(page).textContent()) ?? "";
  const [minutes, seconds] = text.trim().split(":").map(Number);
  return minutes! * 60 + seconds!;
}

test("an editor's timer shows on every open screen, late joiners included", async ({
  page,
  context,
}) => {
  await registerAndVerify(page, uniqueEmail("timer"));
  const canvas = await createCanvas(page, "Stand-up");

  const other = await context.newPage();
  for (const screen of [page, other]) {
    await screen.goto(`/canvas/${canvas.id}`);
    await expect(
      screen.getByRole("button", { name: "More canvas options" }),
    ).toBeVisible({ timeout: 30_000 });
  }

  await page.getByRole("button", { name: "More canvas options" }).click();
  await page.getByRole("menuitem", { name: "Shared timer" }).click();
  await expect(
    page.getByText(/everyone on this canvas sees the same countdown/i),
  ).toBeVisible();
  await page.getByLabel("Minutes").fill("5");
  await page.getByRole("button", { name: "Start" }).click();

  // The other screen shows the countdown within about a second.
  await expect(countdown(other)).toBeVisible({ timeout: 1_500 });
  expect(await secondsLeft(other)).toBeGreaterThan(4 * 60 + 50);

  // Pause shows everywhere too.
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(
    other.getByRole("button", { name: /^Shared timer: .*, paused$/ }),
  ).toBeVisible({ timeout: 1_500 });
  await page.getByRole("button", { name: "Start" }).click();
  await expect(countdown(other)).toBeVisible({ timeout: 1_500 });

  // Someone who opens the canvas now sees the same time left.
  const late = await context.newPage();
  await late.goto(`/canvas/${canvas.id}`);
  await expect(countdown(late)).toBeVisible({ timeout: 30_000 });
  const [lateLeft, otherLeft] = await Promise.all([
    secondsLeft(late),
    secondsLeft(other),
  ]);
  expect(Math.abs(lateLeft - otherLeft)).toBeLessThanOrEqual(2);
});
