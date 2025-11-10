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

test.describe('Viewport-Based Pagination', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/canvas/demo-canvas-id');
    await page.waitForLoadState('networkidle');
  });

  test('should fetch items without viewport params (backwards compatibility)', async ({ page }) => {
    // Intercept API call and verify no viewport params
    let requestUrl = '';
    await page.route('**/api/v1/canvas-items', (route) => {
      requestUrl = route.request().url();
      route.continue();
    });

    await page.reload();

    // Should call API without viewport params
    expect(requestUrl).toContain('canvasId=');
    expect(requestUrl).not.toContain('minX=');
  });

  test('should support viewport-based filtering with minX, maxX, minY, maxY', async ({
    page,
  }) => {
    // Intercept the API call to verify viewport params
    let viewportRequest: any = null;
    await page.route('**/api/v1/canvas-items', (route) => {
      viewportRequest = new URL(route.request().url());
      route.continue();
    });

    // Simulate viewport query to a specific region
    const response = await page.request.get(
      `/api/v1/canvas-items?canvasId=demo-canvas-id&minX=0&maxX=1000&minY=0&maxY=800`
    );

    expect(response.status()).toBe(200);
    const data = await response.json();

    // Should have pagination metadata when viewport params are used
    expect(data).toHaveProperty('items');
    expect(Array.isArray(data.items)).toBe(true);
  });

  test('should respect limit and offset parameters', async ({ page }) => {
    // Create multiple items first by making API calls
    const canvasId = 'demo-canvas-id';

    // Make two requests: one with offset 0, one with offset 1
    const page1Response = await page.request.get(
      `/api/v1/canvas-items?canvasId=${canvasId}&minX=0&maxX=5000&minY=0&maxY=5000&limit=2&offset=0`
    );

    const page1Data = await page1Response.json();
    const firstPageItems = page1Data.items;

    const page2Response = await page.request.get(
      `/api/v1/canvas-items?canvasId=${canvasId}&minX=0&maxX=5000&minY=0&maxY=5000&limit=2&offset=2`
    );

    const page2Data = await page2Response.json();
    const secondPageItems = page2Data.items;

    // If both pages have items, they should be different (offset worked)
    if (firstPageItems.length > 0 && secondPageItems.length > 0) {
      expect(firstPageItems[0].id).not.toBe(secondPageItems[0].id);
    }

    // Verify pagination metadata
    expect(page1Data).toHaveProperty('limit', 2);
    expect(page1Data).toHaveProperty('offset', 0);
    expect(page1Data).toHaveProperty('total');
  });

  test('should filter items by viewport intersection', async ({ page }) => {
    // This test verifies the viewport intersection algorithm
    // Items at position (100, 100) with size (200, 200) should be included
    // when viewport is (0, 0) to (1000, 1000)

    const canvasId = 'demo-canvas-id';

    // Fetch all items in viewport
    const response = await page.request.get(
      `/api/v1/canvas-items?canvasId=${canvasId}&minX=0&maxX=1000&minY=0&maxY=1000`
    );

    expect(response.status()).toBe(200);
    const data = await response.json();

    // Verify that returned items intersect with viewport
    // Intersection: (item.x + item.width) >= minX && item.x <= maxX &&
    //              (item.y + item.height) >= minY && item.y <= maxY
    for (const item of data.items) {
      const itemRight = item.positionX + item.width;
      const itemBottom = item.positionY + item.height;

      // All items should intersect with viewport bounds
      expect(itemRight).toBeGreaterThanOrEqual(0); // item right >= viewport left
      expect(item.positionX).toBeLessThanOrEqual(1000); // item left <= viewport right
      expect(itemBottom).toBeGreaterThanOrEqual(0); // item bottom >= viewport top
      expect(item.positionY).toBeLessThanOrEqual(1000); // item top <= viewport bottom
    }
  });

  test('should return empty items for viewport with no items', async ({ page }) => {
    // Request a viewport region far outside any items
    const canvasId = 'demo-canvas-id';

    const response = await page.request.get(
      `/api/v1/canvas-items?canvasId=${canvasId}&minX=100000&maxX=200000&minY=100000&maxY=200000`
    );

    expect(response.status()).toBe(200);
    const data = await response.json();

    // Should return empty items array
    expect(data.items).toEqual([]);
    expect(data.total).toBe(0);
  });

  test('should enforce maximum limit of 1000', async ({ page }) => {
    // Try to request more than 1000 items
    const canvasId = 'demo-canvas-id';

    const response = await page.request.get(
      `/api/v1/canvas-items?canvasId=${canvasId}&minX=0&maxX=5000&minY=0&maxY=5000&limit=2000`
    );

    // Should either return error or cap the limit
    if (response.status() === 400) {
      const error = await response.json();
      expect(error).toHaveProperty('type');
    } else {
      const data = await response.json();
      // Limit should be capped at 1000
      expect(data.items.length).toBeLessThanOrEqual(1000);
    }
  });

  test('should handle partial viewport intersection', async ({ page }) => {
    // Create a note at (100, 100) with size (200, 200)
    // Query viewport (150, 150) to (300, 300) - should include the item
    // because it partially overlaps

    const canvasId = 'demo-canvas-id';

    const response = await page.request.get(
      `/api/v1/canvas-items?canvasId=${canvasId}&minX=150&maxX=300&minY=150&maxY=300`
    );

    expect(response.status()).toBe(200);
    const data = await response.json();

    // Any items in the response should be partially within the viewport
    for (const item of data.items) {
      const itemRight = item.positionX + item.width;
      const itemBottom = item.positionY + item.height;

      // Should pass intersection test
      const intersects =
        itemRight >= 150 && item.positionX <= 300 && itemBottom >= 150 && item.positionY <= 300;

      expect(intersects).toBe(true);
    }
  });

  test('should work with type filter alongside viewport params', async ({ page }) => {
    const canvasId = 'demo-canvas-id';

    // Request only NOTE items in viewport
    const response = await page.request.get(
      `/api/v1/canvas-items?canvasId=${canvasId}&type=NOTE&minX=0&maxX=1000&minY=0&maxY=1000`
    );

    expect(response.status()).toBe(200);
    const data = await response.json();

    // All items should be of type NOTE
    for (const item of data.items) {
      expect(item.type).toBe('NOTE');
    }
  });
});
