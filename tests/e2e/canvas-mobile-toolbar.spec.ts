import { expect, test, type Locator } from "@playwright/test";
import { createCanvas, registerAndVerify, uniqueEmail } from "./helpers";

/**
 * IMP-078: on a phone the canvas top bar shows back, a shortened title,
 * share and one "More" menu; nothing overlaps or is clipped, and every tap
 * target is at least 44x44px.
 */

type Box = { x: number; y: number; width: number; height: number };

function overlaps(a: Box, b: Box) {
  return (
    a.x < b.x + b.width - 0.5 &&
    b.x < a.x + a.width - 0.5 &&
    a.y < b.y + b.height - 0.5 &&
    b.y < a.y + a.height - 0.5
  );
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("control is not rendered");
  return box;
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 360, height: 740 },
]) {
  test(`canvas top bar fits at ${viewport.width}px`, async ({ page }) => {
    await registerAndVerify(page, uniqueEmail("mobile-toolbar"));
    const canvas = await createCanvas(
      page,
      "A rather long canvas name that must shorten on a phone",
    );

    await page.setViewportSize(viewport);
    await page.goto(`/canvas/${canvas.id}`);

    const bar = page.locator("header").first();
    const controls = {
      back: bar.getByRole("button", { name: "Back to dashboard" }),
      title: bar.getByRole("heading", { level: 1 }),
      share: bar.getByRole("button", { name: "Share canvas" }),
      more: bar.getByRole("button", { name: "More canvas options" }),
    };
    for (const control of Object.values(controls)) {
      await expect(control).toBeVisible();
    }

    const boxes = Object.fromEntries(
      await Promise.all(
        Object.entries(controls).map(
          async ([name, control]) => [name, await boxOf(control)] as const,
        ),
      ),
    );
    const names = Object.keys(boxes);
    for (let i = 0; i < names.length; i++) {
      const box = boxes[names[i]!]!;
      expect(box.x, `${names[i]} starts on screen`).toBeGreaterThanOrEqual(0);
      expect(
        box.x + box.width,
        `${names[i]} ends on screen`,
      ).toBeLessThanOrEqual(viewport.width);
      for (let j = i + 1; j < names.length; j++) {
        expect(
          overlaps(box, boxes[names[j]!]!),
          `${names[i]} overlaps ${names[j]}`,
        ).toBe(false);
      }
    }
    for (const name of ["back", "share", "more"]) {
      expect(boxes[name]!.width).toBeGreaterThanOrEqual(44);
      expect(boxes[name]!.height).toBeGreaterThanOrEqual(44);
    }

    const scrollsSideways = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(scrollsSideways).toBe(false);

    await controls.more.click();
    const menu = page.getByRole("menu", { name: "More canvas options" });
    for (const label of [
      "Rename canvas",
      "Zoom in",
      "Version history",
      "Export canvas",
    ]) {
      await expect(menu.getByRole("menuitem", { name: label })).toBeVisible();
    }
  });
}
