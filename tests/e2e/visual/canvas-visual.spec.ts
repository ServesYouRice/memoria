/**
 * Visual Regression Tests for Canvas Board
 *
 * Uses Percy for visual snapshot testing.
 * Run with: npx percy exec -- pnpm test:e2e tests/e2e/visual/
 *
 * Note: Requires PERCY_TOKEN environment variable.
 */

import { test } from "@playwright/test";
import percySnapshot from "@percy/playwright";

// Skip visual tests if Percy token not set
const itPercy = process.env.PERCY_TOKEN ? test : test.skip;

test.describe("Canvas Visual Regression", () => {
  test.beforeEach(async ({ page }) => {
    // Login first
    await page.goto("/auth/signin");
    await page.waitForLoadState("networkidle");

    // Fill credentials (adjust for your auth setup)
    const emailInput = page.locator('input[type="email"], input[name="email"]');
    if (await emailInput.isVisible()) {
      await emailInput.fill("test@example.com");
      await page.locator('input[type="password"]').fill("password123");
      await page.locator('button[type="submit"]').click();
      await page.waitForURL(/\/(dashboard|canvas)/);
    }
  });

  itPercy("empty canvas state", async ({ page }) => {
    // Navigate to a test canvas
    await page.goto("/canvas/test-visual-canvas");
    await page.waitForLoadState("networkidle");

    // Wait for canvas stage to render
    await page.waitForSelector(
      '[data-testid="canvas-stage"], .konvajs-content',
      {
        timeout: 10000,
      },
    );

    // Take Percy snapshot
    await percySnapshot(page, "Canvas - Empty State");
  });

  itPercy("canvas with note items", async ({ page }) => {
    await page.goto("/canvas/test-visual-canvas");
    await page.waitForLoadState("networkidle");
    await page.waitForSelector(".konvajs-content");

    // Create a note via keyboard shortcut or button
    const addNoteBtn = page.locator(
      '[data-testid="add-note-button"], button:has-text("Note")',
    );
    if (await addNoteBtn.isVisible()) {
      await addNoteBtn.click();

      // Fill note dialog
      const noteInput = page.locator('textarea, [data-testid="note-input"]');
      if (await noteInput.isVisible()) {
        await noteInput.fill("Test note for visual regression");
        await page
          .locator('button:has-text("Save"), button:has-text("Create")')
          .click();
      }

      await page.waitForTimeout(500);
    }

    await percySnapshot(page, "Canvas - With Notes");
  });

  itPercy("canvas header and toolbar", async ({ page }) => {
    await page.goto("/canvas/test-visual-canvas");
    await page.waitForLoadState("networkidle");

    // Focus on header area
    await page.waitForSelector('[data-testid="canvas-header"], header');

    await percySnapshot(page, "Canvas - Header and Toolbar");
  });

  itPercy("canvas dark mode", async ({ page }) => {
    // Enable dark mode
    await page.emulateMedia({ colorScheme: "dark" });

    await page.goto("/canvas/test-visual-canvas");
    await page.waitForLoadState("networkidle");
    await page.waitForSelector(".konvajs-content");

    await percySnapshot(page, "Canvas - Dark Mode");
  });

  itPercy("canvas zoom states", async ({ page }) => {
    await page.goto("/canvas/test-visual-canvas");
    await page.waitForLoadState("networkidle");
    await page.waitForSelector(".konvajs-content");

    // Zoom out
    const zoomOutBtn = page.locator(
      '[data-testid="zoom-out"], button[aria-label*="zoom out" i]',
    );
    if (await zoomOutBtn.isVisible()) {
      await zoomOutBtn.click();
      await zoomOutBtn.click();
    }

    await percySnapshot(page, "Canvas - Zoomed Out");
  });

  itPercy("mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/canvas/test-visual-canvas");
    await page.waitForLoadState("networkidle");

    await percySnapshot(page, "Canvas - Mobile View");
  });
});
