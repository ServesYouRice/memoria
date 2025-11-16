import { test, expect } from '@playwright/test';

/**
 * E2E Tests for Authentication Flow
 *
 * FIXED: Issue #34 - Missing E2E tests for authentication
 *
 * Critical user flows:
 * - User registration
 * - Login with valid credentials
 * - Login with invalid credentials
 * - Logout
 * - Protected route access
 * - Session persistence
 */

test.describe('Authentication', () => {
  const testUser = {
    name: 'Test User',
    email: `test-${Date.now()}@example.com`,
    password: 'SecurePassword123!',
  };

  test.describe('Registration', () => {
    test('should register a new user successfully', async ({ page }) => {
      await page.goto('/auth/register');

      // Fill registration form
      await page.fill('input[name="name"]', testUser.name);
      await page.fill('input[name="email"]', testUser.email);
      await page.fill('input[name="password"]', testUser.password);
      await page.fill('input[name="confirmPassword"]', testUser.password);

      // Submit form
      await page.click('button[type="submit"]');

      // Should redirect to dashboard or show success message
      await expect(page).toHaveURL(/\/(dashboard|auth\/verify-email)/);
    });

    test('should show error for duplicate email', async ({ page }) => {
      await page.goto('/auth/register');

      // Use existing email
      await page.fill('input[name="name"]', testUser.name);
      await page.fill('input[name="email"]', testUser.email);
      await page.fill('input[name="password"]', testUser.password);
      await page.fill('input[name="confirmPassword"]', testUser.password);

      await page.click('button[type="submit"]');

      // Should show error message
      await expect(page.locator('text=/email.*already exists/i')).toBeVisible({
        timeout: 5000,
      });
    });

    test('should validate password strength', async ({ page }) => {
      await page.goto('/auth/register');

      await page.fill('input[name="name"]', 'Test User');
      await page.fill('input[name="email"]', 'test@example.com');
      await page.fill('input[name="password"]', 'weak'); // Weak password
      await page.fill('input[name="confirmPassword"]', 'weak');

      await page.click('button[type="submit"]');

      // Should show password strength error
      await expect(page.locator('text=/password.*weak|password.*at least/i')).toBeVisible({
        timeout: 3000,
      });
    });

    test('should validate matching passwords', async ({ page }) => {
      await page.goto('/auth/register');

      await page.fill('input[name="name"]', 'Test User');
      await page.fill('input[name="email"]', 'test@example.com');
      await page.fill('input[name="password"]', 'SecurePassword123!');
      await page.fill('input[name="confirmPassword"]', 'DifferentPassword123!');

      await page.click('button[type="submit"]');

      // Should show password mismatch error
      await expect(page.locator('text=/passwords.*match/i')).toBeVisible({
        timeout: 3000,
      });
    });
  });

  test.describe('Login', () => {
    test('should login with valid credentials', async ({ page }) => {
      await page.goto('/auth/login');

      // Fill login form
      await page.fill('input[name="email"]', testUser.email);
      await page.fill('input[name="password"]', testUser.password);

      // Submit form
      await page.click('button[type="submit"]');

      // Should redirect to dashboard
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

      // Should show user name or email
      await expect(page.locator(`text=${testUser.name}`)).toBeVisible({
        timeout: 5000,
      });
    });

    test('should show error for invalid credentials', async ({ page }) => {
      await page.goto('/auth/login');

      await page.fill('input[name="email"]', testUser.email);
      await page.fill('input[name="password"]', 'WrongPassword123!');

      await page.click('button[type="submit"]');

      // Should show error message
      await expect(page.locator('text=/invalid.*credentials|incorrect.*password/i')).toBeVisible({
        timeout: 5000,
      });

      // Should stay on login page
      await expect(page).toHaveURL(/\/auth\/login/);
    });

    test('should show error for non-existent user', async ({ page }) => {
      await page.goto('/auth/login');

      await page.fill('input[name="email"]', 'nonexistent@example.com');
      await page.fill('input[name="password"]', 'SomePassword123!');

      await page.click('button[type="submit"]');

      // Should show error message
      await expect(page.locator('text=/invalid.*credentials|user.*not found/i')).toBeVisible({
        timeout: 5000,
      });
    });

    test('should validate email format', async ({ page }) => {
      await page.goto('/auth/login');

      await page.fill('input[name="email"]', 'invalid-email');
      await page.fill('input[name="password"]', 'SomePassword123!');

      await page.click('button[type="submit"]');

      // Should show email validation error
      await expect(page.locator('text=/invalid.*email/i')).toBeVisible({
        timeout: 3000,
      });
    });
  });

  test.describe('Session Persistence', () => {
    test('should persist session across page reloads', async ({ page }) => {
      // Login first
      await page.goto('/auth/login');
      await page.fill('input[name="email"]', testUser.email);
      await page.fill('input[name="password"]', testUser.password);
      await page.click('button[type="submit"]');

      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

      // Reload page
      await page.reload();

      // Should still be logged in
      await expect(page).toHaveURL(/\/dashboard/);
      await expect(page.locator(`text=${testUser.name}`)).toBeVisible({
        timeout: 5000,
      });
    });

    test('should persist session in new tab', async ({ page, context }) => {
      // Login in first tab
      await page.goto('/auth/login');
      await page.fill('input[name="email"]', testUser.email);
      await page.fill('input[name="password"]', testUser.password);
      await page.click('button[type="submit"]');

      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

      // Open new tab
      const newPage = await context.newPage();
      await newPage.goto('/dashboard');

      // Should be logged in automatically
      await expect(newPage).toHaveURL(/\/dashboard/);
      await expect(newPage.locator(`text=${testUser.name}`)).toBeVisible({
        timeout: 5000,
      });

      await newPage.close();
    });
  });

  test.describe('Protected Routes', () => {
    test('should redirect unauthenticated users to login', async ({ page, context }) => {
      // Clear all cookies to ensure unauthenticated state
      await context.clearCookies();

      // Try to access protected route
      await page.goto('/dashboard');

      // Should redirect to login
      await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10000 });
    });

    test('should allow access to protected routes when authenticated', async ({ page }) => {
      // Login first
      await page.goto('/auth/login');
      await page.fill('input[name="email"]', testUser.email);
      await page.fill('input[name="password"]', testUser.password);
      await page.click('button[type="submit"]');

      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

      // Navigate to another protected route
      await page.goto('/canvas/new');

      // Should allow access (not redirect to login)
      await expect(page).not.toHaveURL(/\/auth\/login/);
    });
  });

  test.describe('Logout', () => {
    test('should logout successfully', async ({ page }) => {
      // Login first
      await page.goto('/auth/login');
      await page.fill('input[name="email"]', testUser.email);
      await page.fill('input[name="password"]', testUser.password);
      await page.click('button[type="submit"]');

      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

      // Click logout button (adjust selector based on your UI)
      await page.click('button:has-text("Logout"), button:has-text("Sign out")');

      // Should redirect to homepage or login
      await expect(page).toHaveURL(/\/(auth\/login|$)/, { timeout: 5000 });

      // Try to access protected route
      await page.goto('/dashboard');

      // Should redirect to login
      await expect(page).toHaveURL(/\/auth\/login/, { timeout: 5000 });
    });

    test('should clear session after logout', async ({ page, context }) => {
      // Login first
      await page.goto('/auth/login');
      await page.fill('input[name="email"]', testUser.email);
      await page.fill('input[name="password"]', testUser.password);
      await page.click('button[type="submit"]');

      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

      // Logout
      await page.click('button:has-text("Logout"), button:has-text("Sign out")');

      // Check cookies are cleared
      const cookies = await context.cookies();
      const authCookie = cookies.find((c) => c.name.includes('auth') || c.name.includes('session'));

      expect(authCookie).toBeUndefined();
    });
  });

  test.describe('Rate Limiting', () => {
    test('should rate limit failed login attempts', async ({ page }) => {
      await page.goto('/auth/login');

      // Attempt multiple failed logins
      for (let i = 0; i < 6; i++) {
        await page.fill('input[name="email"]', testUser.email);
        await page.fill('input[name="password"]', 'WrongPassword123!');
        await page.click('button[type="submit"]');

        // Wait for response
        await page.waitForTimeout(500);
      }

      // Should show rate limit error after 5 attempts
      await expect(page.locator('text=/too many.*attempts|rate limit/i')).toBeVisible({
        timeout: 3000,
      });
    });
  });

  test.describe('Password Reset', () => {
    test('should request password reset', async ({ page }) => {
      await page.goto('/auth/forgot-password');

      await page.fill('input[name="email"]', testUser.email);
      await page.click('button[type="submit"]');

      // Should show success message
      await expect(page.locator('text=/email.*sent|check.*email/i')).toBeVisible({
        timeout: 5000,
      });
    });

    test('should show success even for non-existent email', async ({ page }) => {
      // Security: Don't reveal if email exists
      await page.goto('/auth/forgot-password');

      await page.fill('input[name="email"]', 'nonexistent@example.com');
      await page.click('button[type="submit"]');

      // Should still show success message
      await expect(page.locator('text=/email.*sent|check.*email/i')).toBeVisible({
        timeout: 5000,
      });
    });
  });
});
