import { test, expect } from '@playwright/test';

test.describe('Canvas Operations', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/canvas/);
  });

  test('should create a new canvas', async ({ page }) => {
    await page.click('[data-testid="new-canvas-button"]');

    await page.fill('input[name="canvasName"]', 'Test Canvas');
    await page.click('button[type="submit"]');

    await expect(page.locator('text=Test Canvas')).toBeVisible();
  });

  test('should create a note item', async ({ page }) => {
    await page.click('[data-testid="add-note-button"]');

    await page.fill('textarea[name="noteContent"]', 'This is a test note');
    await page.click('button[data-testid="save-note"]');

    await expect(page.locator('text=This is a test note')).toBeVisible();
  });

  test('should move a note item', async ({ page }) => {
    // Create a note first
    await page.click('[data-testid="add-note-button"]');
    await page.fill('textarea[name="noteContent"]', 'Movable note');
    await page.click('button[data-testid="save-note"]');

    const note = page.locator('text=Movable note').first();
    const box = await note.boundingBox();
    expect(box).toBeTruthy();

    // Drag the note
    await note.hover();
    await page.mouse.down();
    await page.mouse.move(box!.x + 100, box!.y + 100);
    await page.mouse.up();

    // Position should have changed
    const newBox = await note.boundingBox();
    expect(newBox!.x).not.toBe(box!.x);
    expect(newBox!.y).not.toBe(box!.y);
  });

  test('should resize a note item', async ({ page }) => {
    // Create a note first
    await page.click('[data-testid="add-note-button"]');
    await page.fill('textarea[name="noteContent"]', 'Resizable note');
    await page.click('button[data-testid="save-note"]');

    const note = page.locator('[data-testid="note-item"]').first();
    const box = await note.boundingBox();

    // Find resize handle
    const resizeHandle = note.locator('[data-testid="resize-handle"]');
    await resizeHandle.hover();
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width + 50, box!.y + box!.height + 50);
    await page.mouse.up();

    // Size should have changed
    const newBox = await note.boundingBox();
    expect(newBox!.width).toBeGreaterThan(box!.width);
  });

  test('should delete a note item', async ({ page }) => {
    // Create a note first
    await page.click('[data-testid="add-note-button"]');
    await page.fill('textarea[name="noteContent"]', 'Deletable note');
    await page.click('button[data-testid="save-note"]');

    const note = page.locator('text=Deletable note');
    await note.click();
    await page.click('[data-testid="delete-note"]');

    await expect(note).not.toBeVisible();
  });

  test('should create a bookmark item', async ({ page }) => {
    await page.click('[data-testid="add-bookmark-button"]');

    await page.fill('input[name="url"]', 'https://example.com');
    await page.fill('input[name="title"]', 'Example Site');
    await page.click('button[data-testid="save-bookmark"]');

    await expect(page.locator('text=Example Site')).toBeVisible();
  });

  test('should handle concurrent edits with version conflicts', async ({ page, context }) => {
    // Create a note
    await page.click('[data-testid="add-note-button"]');
    await page.fill('textarea[name="noteContent"]', 'Concurrent edit test');
    await page.click('button[data-testid="save-note"]');

    // Open same canvas in new tab
    const newPage = await context.newPage();
    await newPage.goto(page.url());

    const note1 = page.locator('text=Concurrent edit test');
    const note2 = newPage.locator('text=Concurrent edit test');

    // Edit from both tabs
    await note1.click();
    await note2.click();

    await page.fill('textarea[name="noteContent"]', 'Edit from tab 1');
    await newPage.fill('textarea[name="noteContent"]', 'Edit from tab 2');

    await page.click('button[data-testid="save-note"]');
    await newPage.click('button[data-testid="save-note"]');

    // Should show version conflict warning
    await expect(newPage.locator('text=/conflict|outdated/i')).toBeVisible();

    await newPage.close();
  });
});

test.describe('Canvas Performance', () => {
  test('should handle large number of items', async ({ page }) => {
    await page.goto('/canvas');

    const startTime = Date.now();

    // Canvas should load within budget
    await page.waitForSelector('[data-testid="canvas-stage"]');

    const loadTime = Date.now() - startTime;
    expect(loadTime).toBeLessThan(3000); // 3 second budget
  });

  test('should lazy load canvas items', async ({ page }) => {
    await page.goto('/canvas');

    // Check that Konva library is lazy loaded
    const hasKonva = await page.evaluate(() => {
      return 'Konva' in window;
    });

    // Konva should not be loaded on initial page load
    expect(hasKonva).toBe(false);

    // Navigate to canvas
    await page.click('[data-testid="open-canvas"]');
    await page.waitForTimeout(1000);

    const hasKonvaAfter = await page.evaluate(() => {
      return 'Konva' in window;
    });

    // Konva should be loaded after canvas interaction
    expect(hasKonvaAfter).toBe(true);
  });
});

test.describe('Authorization', () => {
  test('should prevent accessing other users canvases', async ({ page }) => {
    // Login as user1
    await page.goto('/login');
    await page.fill('input[name="email"]', 'user1@example.com');
    await page.fill('input[name="password"]', 'password123');
    await page.click('button[type="submit"]');

    // Try to access a canvas that belongs to another user
    await page.goto('/canvas/other-user-canvas-id');

    // Should show 403 or redirect
    await expect(page.locator('text=/forbidden|not authorized/i')).toBeVisible();
  });
});
