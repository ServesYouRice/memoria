# Testing Guide - CanvasCollect

## Overview

This guide covers all testing practices for the CanvasCollect application, including unit tests, integration tests, and end-to-end tests.

---

## Test Stack

- **Unit/Integration Tests:** Vitest
- **E2E Tests:** Playwright
- **Test Utilities:** @testing-library/react
- **Coverage:** @vitest/coverage-v8
- **DOM Environment:** happy-dom

---

## Running Tests

### Unit Tests

```bash
# Run all unit tests
pnpm test

# Run tests in watch mode
pnpm test:ui

# Run tests with coverage
pnpm test:coverage
```

### E2E Tests

```bash
# Run all E2E tests
pnpm test:e2e

# Run E2E tests with UI
pnpm test:e2e:ui

# Run specific test file
pnpm exec playwright test e2e/auth.spec.ts

# Run tests in headed mode
pnpm exec playwright test --headed
```

---

## Test Structure

### Unit Tests

Located in: `/src/__tests__/`

**Naming Convention:** `*.test.ts` or `*.test.tsx`

**Example:**

```typescript
import { describe, it, expect } from 'vitest'
import { myFunction } from '../myModule'

describe('myFunction', () => {
  it('should return expected result', () => {
    const result = myFunction('input')
    expect(result).toBe('expected')
  })
})
```

### E2E Tests

Located in: `/e2e/`

**Naming Convention:** `*.spec.ts`

**Example:**

```typescript
import { test, expect } from '@playwright/test'

test.describe('Feature Name', () => {
  test('should perform action', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('text=Welcome')).toBeVisible()
  })
})
```

---

## Coverage Requirements

**Minimum Coverage:** 80% for all metrics

**Metrics:**
- Lines: 80%
- Statements: 80%
- Functions: 80%
- Branches: 80%

**CI Enforcement:** Build fails if coverage is below 80%

**Coverage Reports:**
- HTML: `coverage/index.html`
- LCOV: `coverage/lcov.info`
- JSON: `coverage/coverage-summary.json`

---

## Test Categories

### 1. Security Tests

**Location:** `/e2e/security.spec.ts`

**Coverage:**
- CSP headers
- Security headers
- Rate limiting
- Nonce uniqueness

### 2. Authentication Tests

**Location:** `/e2e/auth.spec.ts`

**Coverage:**
- Registration flow
- Login flow
- Logout flow
- Session management
- Password strength
- Rate limiting on auth

### 3. Canvas Tests

**Location:** `/e2e/canvas.spec.ts`

**Coverage:**
- Canvas creation
- Note CRUD operations
- Bookmark CRUD operations
- Drag and drop
- Resize operations
- Concurrent edits
- Authorization checks

### 4. Observability Tests

**Location:** `/e2e/observability.spec.ts`

**Coverage:**
- Health endpoint
- Metrics endpoint
- Prometheus format
- Database checks
- Memory monitoring

### 5. Unit Tests

**Locations:**
- `/src/__tests__/csp.test.ts` - CSP middleware
- `/src/__tests__/logger.test.ts` - Logger utilities

---

## Best Practices

### 1. Test Isolation

Each test should be independent and not rely on other tests.

```typescript
test.describe('Feature', () => {
  test.beforeEach(async ({ page }) => {
    // Set up test state
    await setupTestData()
  })

  test.afterEach(async () => {
    // Clean up
    await cleanupTestData()
  })
})
```

### 2. Test Data

Use unique identifiers for test data to avoid conflicts:

```typescript
const testEmail = `test-${Date.now()}@example.com`
```

### 3. Waiting for Elements

Always use Playwright's auto-waiting features:

```typescript
// Good
await expect(page.locator('text=Success')).toBeVisible()

// Avoid
await page.waitForTimeout(1000)
```

### 4. Selector Strategy

1. Use `data-testid` for critical elements
2. Use text content for user-facing elements
3. Avoid CSS classes (they change frequently)

```typescript
// Best
await page.click('[data-testid="submit-button"]')

// Good
await page.click('text=Submit')

// Avoid
await page.click('.btn-primary')
```

---

## Debugging Tests

### Vitest

```bash
# Run specific test
pnpm test -t "test name"

# Run with UI
pnpm test:ui
```

### Playwright

```bash
# Run with headed browser
pnpm exec playwright test --headed

# Run with debug mode
pnpm exec playwright test --debug

# Run with trace
pnpm exec playwright test --trace on
```

**View trace files:**
```bash
pnpm exec playwright show-trace trace.zip
```

---

## CI/CD Integration

Tests run automatically in CI on:
- Every push
- Every pull request

**Pipeline Order:**
1. Lint
2. Type Check
3. Unit Tests (with coverage)
4. Build
5. E2E Tests

**Artifacts:**
- Coverage reports
- Playwright HTML report
- Test screenshots (on failure)
- Trace files (on failure)

---

## Performance Testing

### Performance Budgets

Enforced via `/scripts/check-bundle-size.mjs`

**Budgets:**
- Landing: 100KB gzipped
- Auth: 125KB gzipped
- Canvas: 150KB gzipped

**Check locally:**
```bash
pnpm run check-bundle
```

---

## Test Fixtures

### Database Fixtures

For E2E tests, use the seed script:

```bash
pnpm run db:seed
```

### User Fixtures

Common test users:

```typescript
const testUsers = {
  regular: {
    email: 'test@example.com',
    password: 'password123'
  },
  admin: {
    email: 'admin@example.com',
    password: 'admin123'
  }
}
```

---

## Troubleshooting

### Tests Failing Locally

1. Ensure database is running
2. Run migrations: `pnpm run db:migrate`
3. Seed test data: `pnpm run db:seed`
4. Clear build cache: `rm -rf .next`

### E2E Tests Timeout

1. Increase timeout in `playwright.config.ts`
2. Check if dev server is running
3. Ensure database connection

### Coverage Not Meeting Threshold

1. Check `coverage/index.html` for details
2. Add tests for uncovered code
3. Review excluded files in `vitest.config.ts`

---

## Future Enhancements

- [ ] Visual regression testing
- [ ] Performance benchmarking
- [ ] Accessibility testing (axe-core)
- [ ] Contract testing
- [ ] Load testing

---

**Last Updated:** 2025-11-10  
**Version:** 1.0.0
