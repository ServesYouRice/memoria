import { test, expect } from '@playwright/test';

/**
 * E2E Tests for Canvas Sharing Functionality
 *
 * FIXED: Issue #34 - Missing E2E tests for sharing features
 *
 * Critical sharing flows:
 * - Create share link
 * - Access shared canvas (view-only)
 * - Access shared canvas (edit permission)
 * - Revoke share link
 * - Expired share links
 * - Public canvas access
 */

test.describe('Canvas Sharing', () => {
  const testUser = {
    email: `test-owner-${Date.now()}@example.com`,
    password: 'SecurePassword123!',
    name: 'Canvas Owner',
  };

  let canvasId: string;
  let shareToken: string;

  test.beforeAll(async ({ browser }) => {
    // Setup: Create test user and canvas
    const page = await browser.newPage();

    // Register and login
    await page.goto('/auth/register');
    await page.fill('input[name="name"]', testUser.name);
    await page.fill('input[name="email"]', testUser.email);
    await page.fill('input[name="password"]', testUser.password);
    await page.fill('input[name="confirmPassword"]', testUser.password);
    await page.click('button[type="submit"]');

    // Wait for dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

    // Create a canvas
    await page.click('button:has-text("New Canvas"), button:has-text("Create")');
    await page.waitForURL(/\/canvas\/.*/, { timeout: 10000 });

    // Extract canvas ID from URL
    const url = page.url();
    const match = url.match(/\/canvas\/([a-z0-9]+)/);
    if (match) {
      canvasId = match[1];
    }

    await page.close();
  });

  test.describe('Create Share Link', () => {
    test('should create a view-only share link', async ({ page }) => {
      // Login as owner
      await page.goto('/auth/login');
      await page.fill('input[name="email"]', testUser.email);
      await page.fill('input[name="password"]', testUser.password);
      await page.click('button[type="submit"]');

      // Navigate to canvas
      await page.goto(`/canvas/${canvasId}`);

      // Open share dialog
      await page.click('button[aria-label="Share"], button:has-text("Share")');

      // Select view-only permission
      await page.selectOption('select[name="permission"]', 'view');

      // Create share link
      await page.click('button:has-text("Create link"), button:has-text("Generate")');

      // Should show share link
      const shareLinkInput = page.locator('input[readonly][value*="/share/"]');
      await expect(shareLinkInput).toBeVisible({ timeout: 5000 });

      // Extract share token
      const shareUrl = await shareLinkInput.inputValue();
      const tokenMatch = shareUrl.match(/\/share\/([a-zA-Z0-9_-]+)/);
      if (tokenMatch) {
        shareToken = tokenMatch[1];
      }

      expect(shareToken).toBeTruthy();
    });

    test('should create an edit share link', async ({ page }) => {
      // Login as owner
      await page.goto('/auth/login');
      await page.fill('input[name="email"]', testUser.email);
      await page.fill('input[name="password"]', testUser.password);
      await page.click('button[type="submit"]');

      await page.goto(`/canvas/${canvasId}`);

      // Open share dialog
      await page.click('button[aria-label="Share"], button:has-text("Share")');

      // Select edit permission
      await page.selectOption('select[name="permission"]', 'edit');

      // Create share link
      await page.click('button:has-text("Create link"), button:has-text("Generate")');

      // Should show share link
      await expect(page.locator('input[readonly][value*="/share/"]')).toBeVisible({
        timeout: 5000,
      });
    });

    test('should create expiring share link', async ({ page }) => {
      // Login as owner
      await page.goto('/auth/login');
      await page.fill('input[name="email"]', testUser.email);
      await page.fill('input[name="password"]', testUser.password);
      await page.click('button[type="submit"]');

      await page.goto(`/canvas/${canvasId}`);

      // Open share dialog
      await page.click('button[aria-label="Share"], button:has-text("Share")');

      // Set expiration date (tomorrow)
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      await page.fill('input[name="expiresAt"]', tomorrow.toISOString().split('T')[0]);

      // Create share link
      await page.click('button:has-text("Create link"), button:has-text("Generate")');

      // Should show share link with expiration info
      await expect(page.locator('text=/expires|valid until/i')).toBeVisible({
        timeout: 5000,
      });
    });

    test('should copy share link to clipboard', async ({ page, context }) => {
      // Grant clipboard permissions
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);

      // Login and navigate to canvas
      await page.goto('/auth/login');
      await page.fill('input[name="email"]', testUser.email);
      await page.fill('input[name="password"]', testUser.password);
      await page.click('button[type="submit"]');

      await page.goto(`/canvas/${canvasId}`);

      // Open share dialog
      await page.click('button[aria-label="Share"], button:has-text("Share")');

      // Click copy button
      await page.click('button:has-text("Copy"), button[aria-label="Copy"]');

      // Should show copied confirmation
      await expect(page.locator('text=/copied/i')).toBeVisible({ timeout: 3000 });
    });
  });

  test.describe('Access Shared Canvas', () => {
    test('should access view-only shared canvas without login', async ({ page, context }) => {
      // Clear cookies to simulate unauthenticated user
      await context.clearCookies();

      // Access shared canvas
      await page.goto(`/share/${shareToken}`);

      // Should load canvas
      await expect(page.locator('[data-testid="canvas-stage"], canvas')).toBeVisible({
        timeout: 10000,
      });

      // Should not show edit controls
      await expect(page.locator('button:has-text("Edit"), button:has-text("Delete")')).not.toBeVisible();

      // Should show view-only indicator
      await expect(page.locator('text=/view.*only|read.*only/i')).toBeVisible({
        timeout: 5000,
      });
    });

    test('should prevent editing in view-only mode', async ({ page, context }) => {
      await context.clearCookies();

      await page.goto(`/share/${shareToken}`);

      // Try to add an item (should not work)
      await page.click('canvas');

      // Should not show add item dialog
      await expect(page.locator('dialog:has-text("Add"), dialog:has-text("Create")')).not.toBeVisible();
    });

    test('should allow editing in edit mode', async ({ page, context }) => {
      // This test assumes you created an edit share link earlier
      // For now, we'll skip if no edit share token available

      await context.clearCookies();

      // Create an edit share link first
      const ownerPage = await context.newPage();
      await ownerPage.goto('/auth/login');
      await ownerPage.fill('input[name="email"]', testUser.email);
      await ownerPage.fill('input[name="password"]', testUser.password);
      await ownerPage.click('button[type="submit"]');

      await ownerPage.goto(`/canvas/${canvasId}`);
      await ownerPage.click('button[aria-label="Share"], button:has-text("Share")');
      await ownerPage.selectOption('select[name="permission"]', 'edit');
      await ownerPage.click('button:has-text("Create link"), button:has-text("Generate")');

      const editShareUrl = await ownerPage.locator('input[readonly][value*="/share/"]').inputValue();
      const editTokenMatch = editShareUrl.match(/\/share\/([a-zA-Z0-9_-]+)/);
      const editToken = editTokenMatch ? editTokenMatch[1] : '';

      await ownerPage.close();

      // Access with edit permissions
      await page.goto(`/share/${editToken}`);

      // Should show edit controls
      await expect(page.locator('button:has-text("Add"), button:has-text("Create")')).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test.describe('Manage Share Links', () => {
    test('should list all active share links', async ({ page }) => {
      // Login as owner
      await page.goto('/auth/login');
      await page.fill('input[name="email"]', testUser.email);
      await page.fill('input[name="password"]', testUser.password);
      await page.click('button[type="submit"]');

      await page.goto(`/canvas/${canvasId}`);

      // Open share dialog
      await page.click('button[aria-label="Share"], button:has-text("Share")');

      // Should show list of existing shares
      await expect(page.locator('[data-testid="share-list"], ul')).toBeVisible({
        timeout: 5000,
      });

      // Should show at least one share link
      await expect(page.locator('li:has-text("view"), li:has-text("edit")')).toBeVisible();
    });

    test('should revoke share link', async ({ page }) => {
      // Login as owner
      await page.goto('/auth/login');
      await page.fill('input[name="email"]', testUser.email);
      await page.fill('input[name="password"]', testUser.password);
      await page.click('button[type="submit"]');

      await page.goto(`/canvas/${canvasId}`);

      // Open share dialog
      await page.click('button[aria-label="Share"], button:has-text("Share")');

      // Click revoke/delete button for first share
      await page.click('button:has-text("Revoke"), button:has-text("Delete")').first();

      // Confirm deletion if modal appears
      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Yes")');
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }

      // Should show success message
      await expect(page.locator('text=/revoked|deleted|removed/i')).toBeVisible({
        timeout: 5000,
      });
    });

    test('should prevent access after revoking share link', async ({ page, context }) => {
      // Revoke the share link first
      await page.goto('/auth/login');
      await page.fill('input[name="email"]', testUser.email);
      await page.fill('input[name="password"]', testUser.password);
      await page.click('button[type="submit"]');

      await page.goto(`/canvas/${canvasId}`);
      await page.click('button[aria-label="Share"], button:has-text("Share")');

      // Get the share token before revoking
      const shareUrlInput = page.locator('input[readonly][value*="/share/"]').first();
      const revokedShareUrl = await shareUrlInput.inputValue();
      const revokedTokenMatch = revokedShareUrl.match(/\/share\/([a-zA-Z0-9_-]+)/);
      const revokedToken = revokedTokenMatch ? revokedTokenMatch[1] : '';

      // Revoke it
      await page.click('button:has-text("Revoke"), button:has-text("Delete")').first();
      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Yes")');
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }

      // Try to access revoked share
      await context.clearCookies();
      const newPage = await context.newPage();
      await newPage.goto(`/share/${revokedToken}`);

      // Should show error or redirect
      await expect(newPage.locator('text=/not found|invalid|expired|revoked/i')).toBeVisible({
        timeout: 5000,
      });

      await newPage.close();
    });
  });

  test.describe('Public Canvas', () => {
    test('should make canvas public', async ({ page }) => {
      // Login as owner
      await page.goto('/auth/login');
      await page.fill('input[name="email"]', testUser.email);
      await page.fill('input[name="password"]', testUser.password);
      await page.click('button[type="submit"]');

      await page.goto(`/canvas/${canvasId}`);

      // Open settings or sharing dialog
      await page.click('button[aria-label="Share"], button:has-text("Share")');

      // Toggle public access
      await page.check('input[type="checkbox"]:near(:text("Public"))');

      // Save changes
      await page.click('button:has-text("Save"), button:has-text("Update")');

      // Should show public URL
      await expect(page.locator('input[readonly][value*="/public/"]')).toBeVisible({
        timeout: 5000,
      });
    });

    test('should access public canvas without login', async ({ page, context }) => {
      // Get public URL first
      const ownerPage = await context.newPage();
      await ownerPage.goto('/auth/login');
      await ownerPage.fill('input[name="email"]', testUser.email);
      await ownerPage.fill('input[name="password"]', testUser.password);
      await ownerPage.click('button[type="submit"]');

      await ownerPage.goto(`/canvas/${canvasId}`);
      await ownerPage.click('button[aria-label="Share"], button:has-text("Share")');

      const publicUrl = await ownerPage.locator('input[readonly][value*="/public/"]').inputValue();
      await ownerPage.close();

      // Access public canvas without authentication
      await context.clearCookies();
      await page.goto(publicUrl);

      // Should load canvas
      await expect(page.locator('[data-testid="canvas-stage"], canvas')).toBeVisible({
        timeout: 10000,
      });

      // Should be view-only
      await expect(page.locator('text=/view.*only|read.*only/i')).toBeVisible({
        timeout: 5000,
      });
    });

    test('should make canvas private again', async ({ page }) => {
      // Login as owner
      await page.goto('/auth/login');
      await page.fill('input[name="email"]', testUser.email);
      await page.fill('input[name="password"]', testUser.password);
      await page.click('button[type="submit"]');

      await page.goto(`/canvas/${canvasId}`);

      // Open sharing dialog
      await page.click('button[aria-label="Share"], button:has-text("Share")');

      // Uncheck public access
      await page.uncheck('input[type="checkbox"]:near(:text("Public"))');

      // Save changes
      await page.click('button:has-text("Save"), button:has-text("Update")');

      // Should show confirmation
      await expect(page.locator('text=/private|removed.*public/i')).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test.describe('Share Link Expiration', () => {
    test('should not access expired share link', async ({ page, context }) => {
      // Create a share link with past expiration
      await page.goto('/auth/login');
      await page.fill('input[name="email"]', testUser.email);
      await page.fill('input[name="password"]', testUser.password);
      await page.click('button[type="submit"]');

      await page.goto(`/canvas/${canvasId}`);
      await page.click('button[aria-label="Share"], button:has-text("Share")');

      // Set expiration to yesterday (if UI allows)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      await page.fill('input[name="expiresAt"]', yesterday.toISOString().split('T')[0]);

      await page.click('button:has-text("Create link"), button:has-text("Generate")');

      const expiredShareUrl = await page.locator('input[readonly][value*="/share/"]').inputValue();
      const expiredTokenMatch = expiredShareUrl.match(/\/share\/([a-zA-Z0-9_-]+)/);
      const expiredToken = expiredTokenMatch ? expiredTokenMatch[1] : '';

      // Try to access expired share
      await context.clearCookies();
      const newPage = await context.newPage();
      await newPage.goto(`/share/${expiredToken}`);

      // Should show expiration error
      await expect(newPage.locator('text=/expired|no longer available/i')).toBeVisible({
        timeout: 5000,
      });

      await newPage.close();
    });
  });

  test.describe('Share Permissions', () => {
    test('should only allow owner to create shares', async ({ page, context }) => {
      // Create another user
      const otherUser = {
        email: `test-other-${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        name: 'Other User',
      };

      await page.goto('/auth/register');
      await page.fill('input[name="name"]', otherUser.name);
      await page.fill('input[name="email"]', otherUser.email);
      await page.fill('input[name="password"]', otherUser.password);
      await page.fill('input[name="confirmPassword"]', otherUser.password);
      await page.click('button[type="submit"]');

      // Try to access owner's canvas directly
      await page.goto(`/canvas/${canvasId}`);

      // Should be denied access or redirected
      await expect(page.locator('text=/not found|access denied|forbidden/i')).toBeVisible({
        timeout: 5000,
      });
    });
  });
});
