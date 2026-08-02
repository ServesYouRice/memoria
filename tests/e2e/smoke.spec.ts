import { expect, test } from "@playwright/test";
import { createCanvas, registerAndVerify, uniqueEmail } from "./helpers";

test.describe("production-critical smoke flow", () => {
  test("registers, signs in with a real session, and opens an owned canvas", async ({
    page,
  }) => {
    const email = uniqueEmail("smoke");
    await registerAndVerify(page, email);
    const canvas = await createCanvas(page, "E2E Canvas");

    await page.goto(`/canvas/${canvas.id}`);
    await expect(
      page.getByRole("heading", { name: "E2E Canvas" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: /infinite canvas/i }),
    ).toBeVisible();
  });

  test("redirects anonymous dashboard access and emits security headers", async ({
    page,
  }) => {
    const response = await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/auth\/login/);
    expect(response?.headers()["content-security-policy"]).toBeTruthy();
    expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("publishes reachable policy, help, status, and sitemap surfaces", async ({
    page,
  }) => {
    await page.goto("/");
    for (const label of ["Help", "Status", "Privacy", "Terms"]) {
      await expect(page.getByRole("link", { name: label })).toBeVisible();
    }

    await page.getByRole("link", { name: "Help" }).click();
    await expect(page.getByRole("heading", { name: "Help" })).toBeVisible();

    const sitemapResponse = await page.request.get("/sitemap.xml");
    expect(sitemapResponse.ok()).toBeTruthy();
    const sitemap = await sitemapResponse.text();
    for (const path of ["/help", "/status", "/privacy", "/terms"]) {
      expect(sitemap).toContain(path);
    }
  });
});
