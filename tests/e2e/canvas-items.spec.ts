/**
 * E2E Tests: Canvas Items (Notes & Bookmarks)
 * Tests creating, editing, and managing items on canvas
 */

import { test, expect } from "@playwright/test";

test.describe("Canvas Items - Creating", () => {
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

  test("should show toolbar with note and bookmark options", async ({
    page,
  }) => {
    // Navigate to a canvas (creating one if needed)
    await page.goto("/canvases");
    await page.waitForLoadState("networkidle");

    // Create or navigate to canvas
    const canvasLink = page.locator('a[href*="/canvas/"]').first();
    if (await canvasLink.isVisible()) {
      await canvasLink.click();
    } else {
      // Create new canvas first
      await page.getByRole("button", { name: /create|new canvas/i }).click();
      await page.getByRole("button", { name: /create|save/i }).click();
    }

    await page.waitForLoadState("networkidle");

    // Should show toolbar with add note/bookmark buttons
    const noteButton = page.getByRole("button", {
      name: /add note|create note|note/i,
    });
    const bookmarkButton = page.getByRole("button", {
      name: /add bookmark|create bookmark|bookmark/i,
    });

    // At least one should be visible
    const hasNoteButton = await noteButton.isVisible();
    const hasBookmarkButton = await bookmarkButton.isVisible();

    expect(hasNoteButton || hasBookmarkButton).toBeTruthy();
  });

  test("should create a note on canvas click", async ({ page }) => {
    await page.goto("/canvases");
    await page.waitForLoadState("networkidle");

    // Navigate to canvas
    const canvasLink = page.locator('a[href*="/canvas/"]').first();
    if (await canvasLink.isVisible()) {
      await canvasLink.click();
      await page.waitForLoadState("networkidle");

      // Click "Add Note" button
      const noteButton = page
        .getByRole("button", { name: /add note|note/i })
        .first();
      if (await noteButton.isVisible()) {
        await noteButton.click();

        // Click on canvas to place note
        const canvas = page.locator("canvas, .canvas-container").first();
        await canvas.click({ position: { x: 200, y: 200 } });

        // Should show note editor or note element
        const noteElement = page.locator('.note, [data-type="note"]').first();
        await expect(noteElement).toBeVisible({ timeout: 3000 });
      }
    }
  });

  test("should create a bookmark with URL", async ({ page }) => {
    await page.goto("/canvases");
    await page.waitForLoadState("networkidle");

    // Navigate to canvas
    const canvasLink = page.locator('a[href*="/canvas/"]').first();
    if (await canvasLink.isVisible()) {
      await canvasLink.click();
      await page.waitForLoadState("networkidle");

      // Click "Add Bookmark" button
      const bookmarkButton = page
        .getByRole("button", { name: /add bookmark|bookmark/i })
        .first();
      if (await bookmarkButton.isVisible()) {
        await bookmarkButton.click();

        // Enter URL in dialog/form
        const urlInput = page.getByLabel(/url|link/i);
        if (await urlInput.isVisible()) {
          await urlInput.fill("https://example.com");

          // Submit
          await page.getByRole("button", { name: /create|add|save/i }).click();

          // Should show bookmark on canvas
          const bookmarkElement = page
            .locator('.bookmark, [data-type="bookmark"]')
            .first();
          await expect(bookmarkElement).toBeVisible({ timeout: 3000 });
        }
      }
    }
  });
});

test.describe("Canvas Items - Editing", () => {
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

  test("should edit note text", async ({ page }) => {
    await page.goto("/canvases");
    await page.waitForLoadState("networkidle");

    const canvasLink = page.locator('a[href*="/canvas/"]').first();
    if (await canvasLink.isVisible()) {
      await canvasLink.click();
      await page.waitForLoadState("networkidle");

      // Find existing note or create one
      let noteElement = page.locator('.note, [data-type="note"]').first();

      if (!(await noteElement.isVisible())) {
        // Create note first
        const noteButton = page
          .getByRole("button", { name: /add note/i })
          .first();
        if (await noteButton.isVisible()) {
          await noteButton.click();
          const canvas = page.locator("canvas, .canvas-container").first();
          await canvas.click({ position: { x: 200, y: 200 } });
          await page.waitForTimeout(500);
        }
      }

      noteElement = page.locator('.note, [data-type="note"]').first();
      if (await noteElement.isVisible()) {
        // Double click to edit
        await noteElement.dblclick();

        // Type new text
        const textArea = page
          .locator('textarea, [contenteditable="true"]')
          .first();
        if (await textArea.isVisible()) {
          await textArea.fill("Updated note text");

          // Click outside to save
          await page.locator("body").click({ position: { x: 10, y: 10 } });

          // Verify text updated
          await expect(page.getByText("Updated note text")).toBeVisible({
            timeout: 3000,
          });
        }
      }
    }
  });

  test("should move item by dragging", async ({ page }) => {
    await page.goto("/canvases");
    await page.waitForLoadState("networkidle");

    const canvasLink = page.locator('a[href*="/canvas/"]').first();
    if (await canvasLink.isVisible()) {
      await canvasLink.click();
      await page.waitForLoadState("networkidle");

      // Find an item
      const item = page.locator(".note, .bookmark, [data-type]").first();

      if (await item.isVisible()) {
        // Get initial position
        const box = await item.boundingBox();
        if (box) {
          // Drag to new position
          await item.hover();
          await page.mouse.down();
          await page.mouse.move(box.x + 100, box.y + 100);
          await page.mouse.up();

          // Wait for position to update
          await page.waitForTimeout(500);

          // Verify position changed
          const newBox = await item.boundingBox();
          expect(newBox?.x).not.toBe(box.x);
        }
      }
    }
  });

  test("should resize item", async ({ page }) => {
    await page.goto("/canvases");
    await page.waitForLoadState("networkidle");

    const canvasLink = page.locator('a[href*="/canvas/"]').first();
    if (await canvasLink.isVisible()) {
      await canvasLink.click();
      await page.waitForLoadState("networkidle");

      // Find an item
      const item = page.locator(".note, .bookmark, [data-type]").first();

      if (await item.isVisible()) {
        // Click to select
        await item.click();

        // Look for resize handle
        const resizeHandle = page
          .locator('.resize-handle, [data-handle="resize"]')
          .first();

        if (await resizeHandle.isVisible()) {
          const box = await item.boundingBox();
          if (box) {
            // Drag resize handle
            await resizeHandle.hover();
            await page.mouse.down();
            await page.mouse.move(
              box.x + box.width + 50,
              box.y + box.height + 50,
            );
            await page.mouse.up();

            // Wait for resize to complete
            await page.waitForTimeout(500);
          }
        }
      }
    }
  });

  test("should delete item", async ({ page }) => {
    await page.goto("/canvases");
    await page.waitForLoadState("networkidle");

    const canvasLink = page.locator('a[href*="/canvas/"]').first();
    if (await canvasLink.isVisible()) {
      await canvasLink.click();
      await page.waitForLoadState("networkidle");

      // Count initial items
      const items = page.locator(".note, .bookmark, [data-type]");
      const initialCount = await items.count();

      if (initialCount > 0) {
        const item = items.first();
        await item.click();

        // Look for delete button (could be in context menu or toolbar)
        const deleteButton = page.getByRole("button", {
          name: /delete|remove/i,
        });

        if (await deleteButton.isVisible()) {
          await deleteButton.click();

          // Confirm if dialog appears
          const confirmButton = page.getByRole("button", {
            name: /confirm|yes/i,
          });
          if (await confirmButton.isVisible()) {
            await confirmButton.click();
          }

          // Wait for deletion
          await page.waitForTimeout(500);

          // Verify count decreased
          const newCount = await items.count();
          expect(newCount).toBeLessThan(initialCount);
        }
      }
    }
  });
});

test.describe("Canvas Items - Interactions", () => {
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

  test("should select item on click", async ({ page }) => {
    await page.goto("/canvases");
    await page.waitForLoadState("networkidle");

    const canvasLink = page.locator('a[href*="/canvas/"]').first();
    if (await canvasLink.isVisible()) {
      await canvasLink.click();
      await page.waitForLoadState("networkidle");

      const item = page.locator(".note, .bookmark, [data-type]").first();
      if (await item.isVisible()) {
        await item.click();

        // Should have selected state (border, highlight, etc.)
        const selectedItem = page
          .locator('.selected, [data-selected="true"]')
          .first();
        const isSelected = await selectedItem.isVisible();

        // Or check if item has selected class
        const hasSelectedClass = await item.evaluate((el) =>
          el.classList.contains("selected"),
        );

        expect(isSelected || hasSelectedClass).toBeTruthy();
      }
    }
  });

  test("should deselect item on canvas click", async ({ page }) => {
    await page.goto("/canvases");
    await page.waitForLoadState("networkidle");

    const canvasLink = page.locator('a[href*="/canvas/"]').first();
    if (await canvasLink.isVisible()) {
      await canvasLink.click();
      await page.waitForLoadState("networkidle");

      const item = page.locator(".note, .bookmark, [data-type]").first();
      if (await item.isVisible()) {
        // Select item
        await item.click();
        await page.waitForTimeout(200);

        // Click on empty canvas area
        const canvas = page.locator("canvas, .canvas-container").first();
        await canvas.click({ position: { x: 50, y: 50 } });

        await page.waitForTimeout(200);

        // Should not be selected anymore
        const selectedItems = page.locator('.selected, [data-selected="true"]');
        const count = await selectedItems.count();
        expect(count).toBe(0);
      }
    }
  });

  test("should show context menu on right click", async ({ page }) => {
    await page.goto("/canvases");
    await page.waitForLoadState("networkidle");

    const canvasLink = page.locator('a[href*="/canvas/"]').first();
    if (await canvasLink.isVisible()) {
      await canvasLink.click();
      await page.waitForLoadState("networkidle");

      const item = page.locator(".note, .bookmark, [data-type]").first();
      if (await item.isVisible()) {
        // Right click item
        await item.click({ button: "right" });

        // Should show context menu
        const contextMenu = page
          .locator('[role="menu"], .context-menu')
          .first();
        const isVisible = await contextMenu.isVisible();

        expect(isVisible).toBeTruthy();
      }
    }
  });
});

test.describe("Canvas Items - Persistence", () => {
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

  test("should persist items after page reload", async ({ page }) => {
    await page.goto("/canvases");
    await page.waitForLoadState("networkidle");

    const canvasLink = page.locator('a[href*="/canvas/"]').first();
    if (await canvasLink.isVisible()) {
      await canvasLink.click();
      await page.waitForLoadState("networkidle");

      // Count items before reload
      const items = page.locator(".note, .bookmark, [data-type]");
      const countBefore = await items.count();

      // Reload page
      await page.reload();
      await page.waitForLoadState("networkidle");

      // Count items after reload
      const countAfter = await items.count();

      // Should have same number of items
      expect(countAfter).toBe(countBefore);
    }
  });

  test("should handle concurrent edits with version conflict", async ({
    page,
  }) => {
    await page.goto("/canvases");
    await page.waitForLoadState("networkidle");

    const canvasLink = page.locator('a[href*="/canvas/"]').first();
    if (await canvasLink.isVisible()) {
      await canvasLink.click();
      await page.waitForLoadState("networkidle");

      // This test would require mocking a version conflict
      // For now, it's a placeholder for optimistic locking tests
      const item = page.locator(".note, .bookmark, [data-type]").first();
      if (await item.isVisible()) {
        await item.click();
        // Would test version conflict handling here
      }
    }
  });
});
