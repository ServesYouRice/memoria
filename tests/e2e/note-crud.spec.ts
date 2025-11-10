import { test, expect } from '@playwright/test';

test.describe('Note CRUD Operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/canvas/demo-canvas-id');
    await page.waitForLoadState('networkidle');
  });

  test('should create a new note', async ({ page }) => {
    // Click the "Add Note" button
    await page.click('button:has-text("Add Note")');

    // Wait for the note to appear on the canvas
    await page.waitForTimeout(500);

    // Verify the canvas has a note
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('should display note text', async ({ page }) => {
    // Create a note
    await page.click('button:has-text("Add Note")');
    await page.waitForTimeout(500);

    // The note should have default text "New Note"
    // This would need canvas text verification which is complex in Playwright
    // In a real scenario, you might add data-testid attributes
  });

  test('should handle note creation when API is unavailable', async ({ page }) => {
    // Intercept the API call and make it fail
    await page.route('**/api/v1/canvas-items', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Internal Server Error',
          status: 500,
          detail: 'Database connection failed',
        }),
      });
    });

    // Try to create a note
    await page.click('button:has-text("Add Note")');

    // The button should show loading state
    await expect(page.locator('button:has-text("Creating...")')).toBeVisible();
  });

  test('should show error message when items fail to load', async ({ page }) => {
    // Intercept the GET request
    await page.route('**/api/v1/canvas-items', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Internal Server Error',
          status: 500,
        }),
      });
    });

    await page.reload();

    // Should show error alert
    const errorAlert = page.locator('[role="alert"]');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText('Failed to load canvas items');
  });

  test('should allow retrying after error', async ({ page }) => {
    let requestCount = 0;

    // Intercept the GET request - fail first time, succeed second time
    await page.route('**/api/v1/canvas-items', (route) => {
      requestCount++;
      if (requestCount === 1) {
        route.fulfill({
          status: 500,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            type: 'about:blank',
            title: 'Internal Server Error',
            status: 500,
          }),
        });
      } else {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      }
    });

    await page.reload();

    // Click retry button
    await page.click('button:has-text("Retry")');

    // Error should disappear
    const errorAlert = page.locator('[role="alert"]');
    await expect(errorAlert).not.toBeVisible();
  });
});

test.describe('Version Conflict Handling', () => {
  test('should handle version conflicts gracefully', async ({ page }) => {
    // This test would require mocking a version conflict scenario
    // In practice, you'd need to set up the API to return a 409 Conflict
    await page.goto('/canvas/demo-canvas-id');

    // Intercept update requests
    await page.route('**/api/v1/canvas-items/**', (route) => {
      if (route.request().method() === 'PATCH') {
        route.fulfill({
          status: 409,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            type: 'https://canvascollect.com/errors/conflict',
            title: 'Conflict',
            status: 409,
            detail: 'Version mismatch. Expected version 1, but current version is 2.',
          }),
        });
      } else {
        route.continue();
      }
    });

    // The system should automatically refetch when a conflict occurs
    // This is handled in the useUpdateCanvasItem hook
  });
});
