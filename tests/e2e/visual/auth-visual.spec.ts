/**
 * Visual Regression Tests for Auth Pages
 * 
 * Uses Percy for visual snapshot testing of authentication flows.
 */

import { test } from '@playwright/test';
import percySnapshot from '@percy/playwright';

const itPercy = process.env.PERCY_TOKEN ? test : test.skip;

test.describe('Auth Pages Visual Regression', () => {
    itPercy('sign in page', async ({ page }) => {
        await page.goto('/auth/signin');
        await page.waitForLoadState('networkidle');

        // Wait for auth form to render
        await page.waitForSelector('form', { timeout: 5000 });

        await percySnapshot(page, 'Auth - Sign In Page');
    });

    itPercy('sign up page', async ({ page }) => {
        await page.goto('/auth/register');
        await page.waitForLoadState('networkidle');

        await page.waitForSelector('form', { timeout: 5000 });

        await percySnapshot(page, 'Auth - Sign Up Page');
    });

    itPercy('sign in page dark mode', async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.goto('/auth/signin');
        await page.waitForLoadState('networkidle');

        await page.waitForSelector('form');

        await percySnapshot(page, 'Auth - Sign In Dark Mode');
    });

    itPercy('sign in page mobile', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto('/auth/signin');
        await page.waitForLoadState('networkidle');

        await percySnapshot(page, 'Auth - Sign In Mobile');
    });

    itPercy('sign in with validation errors', async ({ page }) => {
        await page.goto('/auth/signin');
        await page.waitForLoadState('networkidle');

        // Submit empty form to trigger validation
        const submitBtn = page.locator('button[type="submit"]');
        if (await submitBtn.isVisible()) {
            // Fill invalid email
            await page.locator('input[type="email"], input[name="email"]').fill('invalid');
            await submitBtn.click();

            // Wait for error states
            await page.waitForTimeout(500);
        }

        await percySnapshot(page, 'Auth - Sign In Validation Errors');
    });
});
