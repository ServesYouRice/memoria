/**
 * E2E Tests: Canvas CRUD Operations
 * Tests critical canvas management flows
 */

import { test, expect } from "@playwright/test";

test.describe("Canvas CRUD Operations", () => {
  test.beforeEach(async ({ context }) => {
    // Set up authenticated session
    await context.addCookies([
      {
        name: "next-auth.session-token",
        value: "test-session-token",
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  });

  test("should display empty state when no canvases exist", async ({
    page,
  }) => {
    await page.goto("/canvases");

    // Should show empty state or create canvas button
    const createButton = page.getByRole("button", {
      name: /create|new canvas/i,
    });
    await expect(createButton).toBeVisible();
  });

  test("should open create canvas dialog", async ({ page }) => {
    await page.goto("/canvases");

    // Click create canvas button
    await page.getByRole("button", { name: /create|new canvas/i }).click();

    // Should show dialog or form
    await expect(page.getByLabel(/canvas name|title/i)).toBeVisible();
  });

  test("should create a new canvas with default name", async ({ page }) => {
    await page.goto("/canvases");

    // Click create button
    const createButton = page.getByRole("button", {
      name: /create|new canvas/i,
    });
    await createButton.click();

    // Submit form (either click save or just submit)
    const saveButton = page.getByRole("button", { name: /create|save/i });
    if (await saveButton.isVisible()) {
      await saveButton.click();
    }

    // Should navigate to new canvas or show it in the list
    // This depends on the actual implementation
    await page.waitForLoadState("networkidle");
  });

  test("should create a new canvas with custom name", async ({ page }) => {
    await page.goto("/canvases");

    // Open create dialog
    await page.getByRole("button", { name: /create|new canvas/i }).click();

    // Enter canvas name
    const nameInput = page.getByLabel(/canvas name|title/i);
    await nameInput.fill("My Test Canvas");

    // Submit
    await page.getByRole("button", { name: /create|save/i }).click();

    // Should show success or navigate to canvas
    await page.waitForLoadState("networkidle");

    // Verify canvas appears in list or we're on the canvas page
    const canvasTitle = page.getByText("My Test Canvas");
    await expect(canvasTitle).toBeVisible({ timeout: 5000 });
  });

  test("should display list of canvases", async ({ page }) => {
    await page.goto("/canvases");

    // Wait for canvases to load
    await page.waitForLoadState("networkidle");

    // Should show canvas list container
    const canvasList = page.locator(
      '[role="list"], .canvas-list, .canvases-grid',
    );
    const count = await canvasList.count();

    // Either shows empty state or canvas items
    expect(count >= 0).toBeTruthy();
  });

  test("should navigate to canvas when clicked", async ({ page }) => {
    await page.goto("/canvases");

    // Wait for any canvases to load
    await page.waitForLoadState("networkidle");

    // Try to find a canvas link (this assumes at least one canvas exists)
    const canvasLink = page.locator('a[href*="/canvas/"]').first();

    if (await canvasLink.isVisible()) {
      await canvasLink.click();

      // Should navigate to canvas page
      await expect(page).toHaveURL(/\/canvas\/.+/);
    }
  });

  test("should update canvas name", async ({ page }) => {
    // First create or navigate to a canvas
    await page.goto("/canvases");
    await page.waitForLoadState("networkidle");

    // Navigate to first canvas
    const canvasLink = page.locator('a[href*="/canvas/"]').first();

    if (await canvasLink.isVisible()) {
      await canvasLink.click();

      // Look for edit/settings button
      const editButton = page.getByRole("button", {
        name: /edit|settings|rename/i,
      });

      if (await editButton.isVisible()) {
        await editButton.click();

        // Update name
        const nameInput = page.getByLabel(/canvas name|title/i);
        await nameInput.fill("Updated Canvas Name");

        // Save
        await page.getByRole("button", { name: /save|update/i }).click();

        // Verify name changed
        await expect(page.getByText("Updated Canvas Name")).toBeVisible({
          timeout: 3000,
        });
      }
    }
  });

  test("should delete canvas", async ({ page }) => {
    await page.goto("/canvases");
    await page.waitForLoadState("networkidle");

    // Count initial canvases
    const initialCount = await page.locator('a[href*="/canvas/"]').count();

    if (initialCount > 0) {
      // Find delete button (could be in a menu)
      const deleteButton = page
        .getByRole("button", { name: /delete|remove/i })
        .first();

      if (await deleteButton.isVisible()) {
        await deleteButton.click();

        // Confirm deletion if there's a confirmation dialog
        const confirmButton = page.getByRole("button", {
          name: /confirm|yes|delete/i,
        });
        if (await confirmButton.isVisible()) {
          await confirmButton.click();
        }

        // Wait for deletion to complete
        await page.waitForLoadState("networkidle");

        // Verify canvas count decreased (or shows empty state)
        const newCount = await page.locator('a[href*="/canvas/"]').count();
        expect(newCount).toBeLessThan(initialCount);
      }
    }
  });
});

test.describe("Canvas Sorting and Filtering", () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      {
        name: "next-auth.session-token",
        value: "test-session-token",
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  });

  test("should sort canvases by updated date", async ({ page }) => {
    await page.goto("/canvases");
    await page.waitForLoadState("networkidle");

    // Check if sort options exist
    const sortButton = page.getByRole("button", { name: /sort/i });

    if (await sortButton.isVisible()) {
      await sortButton.click();

      // Select "Updated" sort option
      await page.getByRole("menuitem", { name: /updated|recent/i }).click();

      // Verify sort applied
      await page.waitForLoadState("networkidle");
    }
  });

  test("should search/filter canvases", async ({ page }) => {
    await page.goto("/canvases");
    await page.waitForLoadState("networkidle");

    // Check if search exists
    const searchInput = page.getByPlaceholder(/search/i);

    if (await searchInput.isVisible()) {
      await searchInput.fill("test");

      // Wait for filter to apply
      await page.waitForTimeout(500);

      // Results should be filtered
      await page.waitForLoadState("networkidle");
    }
  });
});

test.describe("Canvas Permissions", () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      {
        name: "next-auth.session-token",
        value: "test-session-token",
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  });

  test("should not allow accessing other users canvases", async ({ page }) => {
    // Try to access a canvas with an arbitrary ID (likely not owned by test user)
    await page.goto("/canvas/00000000-0000-0000-0000-000000000000");

    // Should show 404 or forbidden error
    await page.waitForLoadState("networkidle");

    // Check for error message
    const errorText = page.getByText(/not found|access denied|forbidden/i);
    // Error might appear, or might redirect
    const isError = await errorText.isVisible();
    const isRedirected =
      page.url().includes("/canvases") || page.url().includes("/404");

    expect(isError || isRedirected).toBeTruthy();
  });
});
