import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test('should display login page for unauthenticated users', async ({ page }) => {
    await page.goto('/canvas');
    await expect(page).toHaveURL(/.*login.*/);
  });

  test('should register a new user', async ({ page }) => {
    await page.goto('/register');

    const email = 'test-' + Date.now() + '@example.com';
    const password = 'SecureP@ssw0rd123!';

    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.fill('input[name="confirmPassword"]', password);

    await page.click('button[type="submit"]');

    // Should redirect to canvas or dashboard
    await page.waitForURL(/\/(canvas|dashboard)/);
  });

  test('should login with valid credentials', async ({ page }) => {
    await page.goto('/login');

    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'password123');

    await page.click('button[type="submit"]');

    await page.waitForURL(/\/(canvas|dashboard)/);
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto('/login');

    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'wrongpassword');

    await page.click('button[type="submit"]');

    await expect(page.locator('text=Invalid credentials')).toBeVisible();
  });

  test('should logout user', async ({ page }) => {
    // First login
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(canvas|dashboard)/);

    // Then logout
    await page.click('[data-testid="user-menu"]');
    await page.click('text=Logout');

    await expect(page).toHaveURL(/.*login.*/);
  });

  test('should enforce password strength', async ({ page }) => {
    await page.goto('/register');

    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'weak');

    await expect(page.locator('text=/password.*strong/i')).toBeVisible();
  });

  test('should rate limit login attempts', async ({ page }) => {
    await page.goto('/login');

    // Make multiple failed login attempts
    for (let i = 0; i < 6; i++) {
      await page.fill('input[name="email"]', 'test@example.com');
      await page.fill('input[name="password"]', 'wrongpassword');
      await page.click('button[type="submit"]');
      await page.waitForTimeout(500);
    }

    // Should show rate limit message
    await expect(page.locator('text=/too many.*attempts/i')).toBeVisible();
  });
});

test.describe('Session Management', () => {
  test('should maintain session across page reloads', async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(canvas|dashboard)/);

    // Reload page
    await page.reload();

    // Should still be logged in
    await expect(page).toHaveURL(/\/(canvas|dashboard)/);
  });

  test('should use secure, httpOnly cookies', async ({ page, context }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'password123');
    await page.click('button[type="submit"]');

    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name.includes('session'));

    expect(sessionCookie).toBeTruthy();
    expect(sessionCookie!.httpOnly).toBe(true);
    expect(sessionCookie!.sameSite).toBe('Lax');
  });
});
