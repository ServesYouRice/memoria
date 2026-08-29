import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
  createCanvas,
  createNote,
  registerAndVerify,
  uniqueEmail,
} from "./helpers";

const require = createRequire(import.meta.url);
const nextConfigEntry = require.resolve("eslint-config-next");
const jsxA11yRequire = createRequire(nextConfigEntry);
const jsxA11yEntry = jsxA11yRequire.resolve("eslint-plugin-jsx-a11y");
const axeRequire = createRequire(jsxA11yEntry);
const axeSource = readFileSync(
  axeRequire.resolve("axe-core/axe.min.js"),
  "utf8",
);

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: Array<{ target: string[] }>;
}

async function expectNoSeriousAxeViolations(page: Page, label: string) {
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            context: Document,
            options: Record<string, unknown>,
          ) => Promise<{ violations: AxeViolation[] }>;
        };
      }
    ).axe;
    const result = await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    });
    return result.violations
      .filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      )
      .map(({ id, impact, help, nodes }) => ({
        id,
        impact,
        help,
        targets: nodes.map((node) => node.target),
      }));
  });
  expect(violations, `${label} axe violations`).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
}

test.describe("truthful and accessible launch surface", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "viewport audit");

  test("covers responsive, keyboard, theme, canvas, share, and notification journeys", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/");
    await expect(page.getByText(/200 canvases per account/i)).toBeVisible();
    await expect(
      page.getByText(/2,000 active items per canvas/i),
    ).toBeVisible();
    expect((await page.locator("body").innerText()).toLowerCase()).not.toMatch(
      /unlimited|free forever|enterprise-grade|join thousands|blazing fast|lightning fast|export anywhere/,
    );
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAxeViolations(page, "landing at 320px");

    const ownerEmail = uniqueEmail("launch-owner");
    await registerAndVerify(page, ownerEmail);
    const canvas = await createCanvas(page, "Launch surface canvas");
    await createNote(page, canvas.id, "Alpha roadmap");
    await createNote(page, canvas.id, "Beta context");

    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: width < 768 ? 720 : 900 });
      await page.goto("/dashboard");
      await expect(page.getByRole("main")).toBeVisible();
      await expectNoHorizontalOverflow(page);

      if (width < 900) {
        await expect(
          page.getByRole("button", { name: "Open navigation menu" }),
        ).toBeVisible();
      } else {
        const primary = page.getByRole("navigation", {
          name: "Primary navigation",
        });
        await expect(primary).toBeVisible();
        await expect(
          primary.getByRole("link", { name: /Dashboard/i }),
        ).toHaveAttribute("aria-current", "page");
      }

      await expectNoSeriousAxeViolations(page, `dashboard at ${width}px`);
    }

    await page.setViewportSize({ width: 375, height: 720 });
    await page.goto("/dashboard");
    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.keyboard.press("Tab");
      if (
        await skipLink.evaluate((element) => element === document.activeElement)
      ) {
        break;
      }
    }
    await expect(skipLink).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();

    for (const combination of [
      { selected: "light", system: "dark", code: "rgb(26, 32, 44)" },
      { selected: "dark", system: "light", code: "rgb(226, 232, 240)" },
    ] as const) {
      await page.emulateMedia({
        colorScheme: combination.system,
        reducedMotion: "reduce",
      });
      await page.evaluate((selected) => {
        localStorage.setItem("theme-mode", selected);
      }, combination.selected);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        combination.selected,
      );
      const themeProbe = await page.evaluate(() => {
        const probe = document.createElement("div");
        probe.id = "theme-contract-probe";
        probe.innerHTML =
          '<div class="ProseMirror"><code>code</code></div><div class="command-footer">footer</div>';
        document.body.append(probe);
        return {
          code: getComputedStyle(probe.querySelector("code")!).color,
          footer: getComputedStyle(
            probe.querySelector<HTMLElement>(".command-footer")!,
          ).color,
        };
      });
      expect(themeProbe.code).toBe(combination.code);
      expect(themeProbe.footer).toBe(
        combination.selected === "dark"
          ? "rgba(255, 255, 255, 0.6)"
          : "rgba(0, 0, 0, 0.6)",
      );
    }

    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto(`/canvas/${canvas.id}`);
    const itemRegion = page.getByRole("region", {
      name: `Items on ${canvas.name}`,
    });
    await expect(itemRegion).toHaveCount(1);
    await expect(itemRegion).toContainText("Alpha roadmap");
    await expect(itemRegion).toContainText("Beta context");
    await page.getByRole("button", { name: "Search canvas" }).click();
    await page.getByPlaceholder("Search notes and bookmarks...").fill("Alpha");
    await expect(itemRegion).toContainText(
      "1 search match. All 2 items remain listed as canvas context.",
    );
    await expect(itemRegion).toContainText("Alpha roadmap");
    await expect(itemRegion).toContainText("Beta context");
    expect(
      await page.evaluate(() => {
        const counts = new Map<string, number>();
        for (const element of document.querySelectorAll<HTMLElement>("[id]")) {
          counts.set(element.id, (counts.get(element.id) ?? 0) + 1);
        }
        return [...counts].filter(([, count]) => count > 1);
      }),
    ).toEqual([]);

    await page.setViewportSize({ width: 320, height: 720 });
    const publicStatusLoaded = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/canvases/${canvas.id}`) &&
        response.request().method() === "GET",
    );
    const sharesLoaded = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/canvases/${canvas.id}/share`) &&
        response.request().method() === "GET",
    );
    await page.getByRole("button", { name: "Share canvas" }).click();
    const shareDialog = page.getByRole("dialog", {
      name: `Share ${canvas.name}`,
    });
    await expect(shareDialog).toBeVisible();
    expect((await publicStatusLoaded).status()).toBe(200);
    expect((await sharesLoaded).status()).toBe(200);
    const shareBounds = await shareDialog.boundingBox();
    expect(shareBounds?.x).toBe(0);
    expect(shareBounds?.width).toBeLessThanOrEqual(320);
    const enablePublicResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/canvases/${canvas.id}/public`) &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("switch", { name: "Anyone with the link can view" })
      .click();
    expect((await enablePublicResponse).status()).toBe(200);
    const publicLink = page.getByRole("textbox", { name: "Public share link" });
    await expect(publicLink).toBeVisible();
    const shareUrl = await publicLink.inputValue();
    await page.getByRole("button", { name: "Close share dialog" }).click();

    const publicContext = await browser.newContext({
      baseURL,
      viewport: { width: 375, height: 720 },
    });
    const publicPage = await publicContext.newPage();
    await publicPage.goto(new URL(shareUrl).pathname);
    await expect(
      publicPage.getByRole("region", { name: `Items on ${canvas.name}` }),
    ).toHaveCount(1);
    await expectNoHorizontalOverflow(publicPage);
    await expectNoSeriousAxeViolations(publicPage, "public canvas at 375px");
    await publicContext.close();

    const recipientContext = await browser.newContext({ baseURL });
    const recipientPage = await recipientContext.newPage();
    const recipientEmail = uniqueEmail("launch-recipient");
    await registerAndVerify(recipientPage, recipientEmail);

    await recipientPage.goto("/settings");
    const inAppPreference = recipientPage.getByRole("switch", {
      name: "Canvas invitations in-app notifications",
    });
    await expect(inAppPreference).toBeChecked();
    const disablePreference = recipientPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/notifications/preferences") &&
        response.request().method() === "PUT",
    );
    await inAppPreference.click();
    expect((await disablePreference).status()).toBe(200);

    const suppressedShare = await page.request.post(
      `/api/v1/canvases/${canvas.id}/share`,
      { data: { email: recipientEmail, role: "EDIT" } },
    );
    expect(suppressedShare.status()).toBe(202);
    await expect
      .poll(async () => {
        const response = await recipientPage.request.get(
          "/api/v1/notifications?limit=1&offset=0",
        );
        return ((await response.json()) as { unread: number }).unread;
      })
      .toBe(0);

    const enablePreference = recipientPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/notifications/preferences") &&
        response.request().method() === "PUT",
    );
    await inAppPreference.click();
    expect((await enablePreference).status()).toBe(200);

    const actionableShare = await page.request.post(
      `/api/v1/canvases/${canvas.id}/share`,
      { data: { email: recipientEmail, role: "EDIT" } },
    );
    expect(actionableShare.status()).toBe(202);
    await expect
      .poll(async () => {
        const response = await recipientPage.request.get(
          "/api/v1/notifications?limit=1&offset=0",
        );
        return ((await response.json()) as { unread: number }).unread;
      })
      .toBe(1);

    await recipientPage.goto("/notifications");
    await expect(
      recipientPage.getByText("1 unread notification"),
    ).toBeVisible();
    await recipientPage
      .getByRole("link", { name: "Review invitation" })
      .click();
    await expect(
      recipientPage.getByRole("heading", { name: "Canvas invitation" }),
    ).toBeVisible();
    await recipientPage
      .getByRole("button", { name: "Accept invitation" })
      .click();
    await expect(
      recipientPage.getByRole("heading", { name: "Invitation accepted" }),
    ).toBeVisible();
    await expect(
      recipientPage.getByRole("link", { name: "Open canvas" }),
    ).toBeVisible();

    await page.goto("/notifications");
    await expect(page.getByText("1 unread notification")).toBeVisible();
    const markAllResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/notifications") &&
        response.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "Mark all read" }).click();
    expect((await markAllResponse).status()).toBe(200);
    await expect(
      page.getByRole("main").getByText("You are all caught up"),
    ).toBeVisible();

    await recipientContext.close();
  });
});
