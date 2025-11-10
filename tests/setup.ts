import { beforeAll, afterAll } from 'vitest';

beforeAll(async () => {
  // Setup test database if needed
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/canvascollect_test';
  process.env.DEMO_USER_ID = 'test-user-id';
});

afterAll(async () => {
  // Cleanup
});
