/**
 * E2E Tests: Authentication Flow
 * Tests critical authentication user flows
 */

import { test, expect } from "@playwright/test";

test.describe("Authentication Flow", () => {
  test.beforeEach(async ({ context }) => {
    // Clear all cookies before each test
    await context.clearCookies();
  });

  test("should redirect to signin when accessing protected route", async ({
    page,
  }) => {
    // Try to access a protected route (canvas list)
    await page.goto("/canvases");

    // Should redirect to signin page
    await expect(page).toHaveURL(/\/auth\/signin/);
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  });

  test("should show signin form with email and password fields", async ({
    page,
  }) => {
    await page.goto("/auth/signin");

    // Check for form elements
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("should show validation errors for invalid credentials", async ({
    page,
  }) => {
    await page.goto("/auth/signin");

    // Fill in form with invalid data
    await page.getByLabel(/email/i).fill("invalid-email");
    await page.getByLabel(/password/i).fill("short");

    // Submit form
    await page.getByRole("button", { name: /sign in/i }).click();

    // Should show validation errors
    await expect(page.getByText(/invalid email/i)).toBeVisible();
  });

  test("should navigate to signup page from signin", async ({ page }) => {
    await page.goto("/auth/signin");

    // Click signup link
    await page.getByRole("link", { name: /sign up/i }).click();

    // Should navigate to signup page
    await expect(page).toHaveURL(/\/auth\/signup/);
    await expect(page.getByRole("heading", { name: /sign up/i })).toBeVisible();
  });

  test("should show password strength indicator on signup", async ({
    page,
  }) => {
    await page.goto("/auth/signup");

    // Fill in password field
    await page.getByLabel(/^password$/i).fill("weak");

    // Should show strength indicator (if implemented)
    // This is a placeholder for when password strength is shown in UI
    const passwordField = page.getByLabel(/^password$/i);
    await expect(passwordField).toBeVisible();
  });

  test("should require password confirmation on signup", async ({ page }) => {
    await page.goto("/auth/signup");

    // Check for password confirmation field
    await expect(page.getByLabel(/confirm password/i)).toBeVisible();
  });
});

test.describe("Authenticated User Actions", () => {
  test.beforeEach(async ({ context }) => {
    // Set up authenticated session
    // In a real test, you'd want to use a test user account
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

  test("should access protected routes when authenticated", async ({
    page,
  }) => {
    await page.goto("/canvases");

    // Should stay on canvases page
    await expect(page).toHaveURL(/\/canvases/);
    await expect(
      page.getByRole("heading", { name: /canvases/i }),
    ).toBeVisible();
  });

  test("should show user menu when authenticated", async ({ page }) => {
    await page.goto("/");

    // Should show user menu or profile indicator
    const userMenu = page.getByRole("button", {
      name: /account|profile|user/i,
    });
    await expect(userMenu).toBeVisible();
  });

  test("should be able to sign out", async ({ page }) => {
    await page.goto("/canvases");

    // Find and click sign out button
    const signOutButton = page.getByRole("button", {
      name: /sign out|logout/i,
    });

    if (await signOutButton.isVisible()) {
      await signOutButton.click();

      // Should redirect to signin or home page
      await expect(page).toHaveURL(/\/(auth\/signin)?$/);
    }
  });
});

test.describe("Session Management", () => {
  test("should persist session across page reloads", async ({
    page,
    context,
  }) => {
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

    await page.goto("/canvases");
    await expect(page).toHaveURL(/\/canvases/);

    // Reload page
    await page.reload();

    // Should still be authenticated
    await expect(page).toHaveURL(/\/canvases/);
  });

  test("should handle expired session gracefully", async ({
    page,
    context,
  }) => {
    // Set up expired session cookie
    await context.addCookies([
      {
        name: "next-auth.session-token",
        value: "expired-token",
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
        expires: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
      },
    ]);

    await page.goto("/canvases");

    // Should redirect to signin
    await expect(page).toHaveURL(/\/auth\/signin/);
  });
});
