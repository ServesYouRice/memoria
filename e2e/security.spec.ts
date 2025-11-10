import { test, expect } from '@playwright/test';

test.describe('Security Headers', () => {
  test('should have strict CSP header', async ({ page }) => {
    const response = await page.goto('/');
    expect(response).toBeTruthy();

    const cspHeader = response!.headers()['content-security-policy'];
    expect(cspHeader).toBeTruthy();
    expect(cspHeader).toContain("default-src 'self'");
    expect(cspHeader).toContain("frame-ancestors 'none'");
    expect(cspHeader).toContain("object-src 'none'");
  });

  test('should have X-Frame-Options header', async ({ page }) => {
    const response = await page.goto('/');
    const xFrameOptions = response!.headers()['x-frame-options'];
    expect(xFrameOptions).toBe('DENY');
  });

  test('should have X-Content-Type-Options header', async ({ page }) => {
    const response = await page.goto('/');
    const xContentType = response!.headers()['x-content-type-options'];
    expect(xContentType).toBe('nosniff');
  });

  test('should have Referrer-Policy header', async ({ page }) => {
    const response = await page.goto('/');
    const referrerPolicy = response!.headers()['referrer-policy'];
    expect(referrerPolicy).toBe('strict-origin-when-cross-origin');
  });

  test('should have Permissions-Policy header', async ({ page }) => {
    const response = await page.goto('/');
    const permissionsPolicy = response!.headers()['permissions-policy'];
    expect(permissionsPolicy).toBeTruthy();
    expect(permissionsPolicy).toContain('camera=()');
    expect(permissionsPolicy).toContain('microphone=()');
  });
});

test.describe('CSP Nonce', () => {
  test('should generate unique nonce per request', async ({ page }) => {
    const response1 = await page.goto('/');
    const nonce1 = response1!.headers()['x-nonce'];

    await page.reload();
    const response2 = await page.goto('/');
    const nonce2 = response2!.headers()['x-nonce'];

    expect(nonce1).toBeTruthy();
    expect(nonce2).toBeTruthy();
    expect(nonce1).not.toBe(nonce2);
  });
});

test.describe('Rate Limiting', () => {
  test('should rate limit excessive API requests', async ({ request }) => {
    const maxRequests = 100;
    const requests = [];

    // Make requests up to the limit
    for (let i = 0; i < maxRequests + 5; i++) {
      requests.push(request.get('/api/v1/test'));
    }

    const responses = await Promise.all(requests);
    const rateLimited = responses.filter((r) => r.status() === 429);

    // Some requests should be rate limited
    expect(rateLimited.length).toBeGreaterThan(0);
  });
});
