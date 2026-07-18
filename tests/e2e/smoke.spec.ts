import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test.describe("production-critical smoke flow", () => {
  test("registers, signs in with a real session, and opens an owned canvas", async ({
    page,
  }) => {
    const suffix = randomUUID();
    const email = `e2e-${suffix}@example.com`;
    const password = "Correct-Horse-Battery-Staple-42!";

    await page.goto("/auth/register");
    await page.getByLabel("Full name").fill("E2E User");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByRole("alert")).toContainText("Account created");
    await expect(page).toHaveURL(/\/auth\/login\?registered=true/, {
      timeout: 10_000,
    });

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });

    const createResponse = await page.request.post("/api/v1/canvases", {
      data: { name: "E2E Canvas" },
      headers: { "x-idempotency-key": randomUUID() },
    });
    expect(createResponse.status()).toBe(201);
    const canvas = (await createResponse.json()) as { id: string };

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
