/**
 * E2E tests for Bookmark CRUD operations
 *
 * Tests the complete user journey:
 * 1. Create a bookmark
 * 2. Move a bookmark
 * 3. Resize a bookmark
 * 4. Delete a bookmark
 *
 * Also tests error scenarios and authorization
 */

import { test, expect } from '@playwright/test';

// Helper to setup authenticated session
async function loginAsTestUser(page: any) {
  await page.goto('/login');
  await page.fill('[name="email"]', 'test@example.com');
  await page.fill('[name="password"]', 'testpassword123');
  await page.click('button[type="submit"]');
  await page.waitForURL('/canvas/*');
}

test.describe('Bookmark CRUD Operations', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await loginAsTestUser(page);
  });

  test('should create a bookmark from dialog', async ({ page }) => {
    // Open create bookmark dialog
    await page.click('[data-testid="add-bookmark-button"]');

    // Fill in URL
    await page.fill('[name="url"]', 'https://example.com');

    // Submit
    await page.click('button:has-text("Create Bookmark")');

    // Wait for dialog to close
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();

    // Verify bookmark appears on canvas
    await expect(page.locator('[data-testid^="bookmark-item-"]')).toBeVisible();

    // Verify URL is displayed
    await expect(page.locator('text=https://example.com')).toBeVisible();
  });

  test('should validate URL format', async ({ page }) => {
    await page.click('[data-testid="add-bookmark-button"]');

    // Try invalid URL
    await page.fill('[name="url"]', 'not a url');
    await page.click('button:has-text("Create Bookmark")');

    // Should show validation error
    await expect(page.locator('text=Invalid URL')).toBeVisible();

    // Dialog should remain open
    await expect(page.locator('[role="dialog"]')).toBeVisible();
  });

  test('should reject non-http(s) protocols', async ({ page }) => {
    await page.click('[data-testid="add-bookmark-button"]');

    // Try file:// protocol
    await page.fill('[name="url"]', 'file:///etc/passwd');
    await page.click('button:has-text("Create Bookmark")');

    // Should show validation error
    await expect(page.locator('text=/must use http.*protocol/i')).toBeVisible();
  });

  test('should move bookmark on drag', async ({ page }) => {
    // Create a bookmark first
    await page.click('[data-testid="add-bookmark-button"]');
    await page.fill('[name="url"]', 'https://test-drag.com');
    await page.click('button:has-text("Create Bookmark")');

    // Get bookmark element
    const bookmark = page.locator('[data-testid^="bookmark-item-"]').first();
    const initialBox = await bookmark.boundingBox();
    expect(initialBox).toBeTruthy();

    // Drag bookmark
    await bookmark.dragTo(page.locator('canvas'), {
      targetPosition: { x: initialBox!.x + 200, y: initialBox!.y + 100 },
    });

    // Wait for autosave
    await page.waitForTimeout(1000);

    // Verify "Saving..." indicator appears and disappears
    await expect(page.locator('text=Saving...')).toBeVisible({ timeout: 500 });
    await expect(page.locator('text=Saving...')).not.toBeVisible({ timeout: 3000 });

    // Refresh page to verify persistence
    await page.reload();

    // Verify bookmark is in new position
    const newBox = await bookmark.boundingBox();
    expect(newBox).toBeTruthy();
    expect(Math.abs(newBox!.x - initialBox!.x)).toBeGreaterThan(100);
  });

  test('should resize bookmark using handles', async ({ page }) => {
    // Create a bookmark
    await page.click('[data-testid="add-bookmark-button"]');
    await page.fill('[name="url"]', 'https://test-resize.com');
    await page.click('button:has-text("Create Bookmark")');

    const bookmark = page.locator('[data-testid^="bookmark-item-"]').first();

    // Select bookmark to show resize handles
    await bookmark.click();

    // Get resize handle (bottom-right)
    const resizeHandle = page.locator('[data-testid="resize-handle-se"]').first();
    await expect(resizeHandle).toBeVisible();

    const initialBox = await bookmark.boundingBox();
    expect(initialBox).toBeTruthy();

    // Drag resize handle
    await resizeHandle.dragTo(page.locator('canvas'), {
      targetPosition: { x: initialBox!.x + 400, y: initialBox!.y + 200 },
    });

    // Wait for autosave
    await page.waitForTimeout(1000);

    // Verify size changed
    const newBox = await bookmark.boundingBox();
    expect(newBox).toBeTruthy();
    expect(newBox!.width).toBeGreaterThan(initialBox!.width);
    expect(newBox!.height).toBeGreaterThan(initialBox!.height);
  });

  test('should delete bookmark', async ({ page }) => {
    // Create a bookmark
    await page.click('[data-testid="add-bookmark-button"]');
    await page.fill('[name="url"]', 'https://test-delete.com');
    await page.click('button:has-text("Create Bookmark")');

    const bookmark = page.locator('[data-testid^="bookmark-item-"]').first();

    // Select bookmark to show delete button
    await bookmark.click();

    // Setup dialog confirmation handler
    page.on('dialog', (dialog) => dialog.accept());

    // Click delete button
    await page.click('[data-testid="delete-bookmark-button"]').first();

    // Verify bookmark is removed
    await expect(bookmark).not.toBeVisible({ timeout: 2000 });

    // Refresh and verify it's gone
    await page.reload();
    await expect(page.locator('text=https://test-delete.com')).not.toBeVisible();
  });

  test('should show Phase 2 notice about unfurling', async ({ page }) => {
    await page.click('[data-testid="add-bookmark-button"]');

    // Should show info about Phase 2
    await expect(page.locator('text=/metadata.*Phase 2/i')).toBeVisible();
  });

  test('should handle concurrent edits with version conflict', async ({ page, context }) => {
    // This test simulates editing the same bookmark from two tabs

    // Create a bookmark
    await page.click('[data-testid="add-bookmark-button"]');
    await page.fill('[name="url"]', 'https://test-concurrent.com');
    await page.click('button:has-text("Create Bookmark")');

    const bookmarkId = await page
      .locator('[data-testid^="bookmark-item-"]')
      .first()
      .getAttribute('data-item-id');

    // Open second tab
    const page2 = await context.newPage();
    await loginAsTestUser(page2);
    await page2.goto(page.url());

    // Both tabs now have the same bookmark
    const bookmark1 = page.locator(`[data-item-id="${bookmarkId}"]`);
    const bookmark2 = page2.locator(`[data-item-id="${bookmarkId}"]`);

    // Move in tab 1
    await bookmark1.dragTo(page.locator('canvas'), {
      targetPosition: { x: 200, y: 200 },
    });
    await page.waitForTimeout(1000); // Wait for autosave

    // Move in tab 2 (should trigger version conflict)
    await bookmark2.dragTo(page2.locator('canvas'), {
      targetPosition: { x: 300, y: 300 },
    });

    // Tab 2 should detect version mismatch and refetch
    // Verify error message or automatic refresh
    await expect(page2.locator('text=/conflict|version/i')).toBeVisible({ timeout: 2000 });
  });

  test('should not allow unauthorized access', async ({ page, context }) => {
    // Create bookmark as user 1
    await page.click('[data-testid="add-bookmark-button"]');
    await page.fill('[name="url"]', 'https://private.com');
    await page.click('button:has-text("Create Bookmark")');

    // Get bookmark ID
    const bookmarkId = await page
      .locator('[data-testid^="bookmark-item-"]')
      .first()
      .getAttribute('data-item-id');

    // Logout and login as different user
    await page.click('[data-testid="logout-button"]');

    const page2 = await context.newPage();
    await page2.goto('/login');
    await page2.fill('[name="email"]', 'other@example.com');
    await page2.fill('[name="password"]', 'otherpassword123');
    await page2.click('button[type="submit"]');

    // Try to access bookmark via API
    const response = await page2.request.get(`/api/v1/canvas-items/${bookmarkId}`);
    expect(response.status()).toBe(403);

    const body = await response.json();
    expect(body.type).toBe('forbidden');
  });
});

test.describe('Bookmark UI Integration', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('should display multiple bookmarks', async ({ page }) => {
    // Create multiple bookmarks
    const urls = ['https://first.com', 'https://second.com', 'https://third.com'];

    for (const url of urls) {
      await page.click('[data-testid="add-bookmark-button"]');
      await page.fill('[name="url"]', url);
      await page.click('button:has-text("Create Bookmark")');
      await page.waitForTimeout(500);
    }

    // Verify all are visible
    for (const url of urls) {
      await expect(page.locator(`text=${url}`)).toBeVisible();
    }
  });

  test('should handle long URLs gracefully', async ({ page }) => {
    const longUrl = 'https://example.com/' + 'a'.repeat(100);

    await page.click('[data-testid="add-bookmark-button"]');
    await page.fill('[name="url"]', longUrl);
    await page.click('button:has-text("Create Bookmark")');

    // URL should be truncated in display
    await expect(page.locator('text=/example\\.com.*\\.\\.\\./')).toBeVisible();
  });
});
