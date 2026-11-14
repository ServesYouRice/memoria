import { expect, test } from "@playwright/test";
import { createCanvas, registerAndVerify, uniqueEmail } from "./helpers";

/** IMP-139: on a phone every tool is reachable and tap targets are 44px. */
for (const viewport of [
  { width: 390, height: 844 },
  { width: 320, height: 640 },
]) {
  test.describe(`phone ${viewport.width}px`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });

    test("canvas toolbar, tap sizes and no sideways scroll", async ({
      page,
    }) => {
      await registerAndVerify(page, uniqueEmail("phone-reach"));
      const canvas = await createCanvas(page, "Phone reach");
      await page.goto(`/canvas/${canvas.id}`);

      const toolbar = page.getByRole("toolbar", { name: "Add to canvas" });
      const more = toolbar.getByRole("button", { name: "More tools" });
      await expect(more).toBeVisible();
      const sizes = await toolbar.evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
      }));
      expect(sizes.scroll).toBe(sizes.client);

      await more.click();
      await page.getByRole("menuitem", { name: "Draw" }).click();
      await expect(more).toHaveAttribute("aria-pressed", "true");

      const buttons = page.locator("header").first().getByRole("button");
      const count = await buttons.count();
      for (let i = 0; i < count; i++) {
        const box = await buttons.nth(i).boundingBox();
        if (!box) continue;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }

      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        ),
      ).toBe(false);
    });
  });
}
