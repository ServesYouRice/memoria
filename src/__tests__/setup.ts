import "@testing-library/jest-dom";

// Mock environment variables
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.NEXTAUTH_URL = "http://localhost:3000";
process.env.NEXTAUTH_SECRET =
  "test-secret-key-for-testing-must-be-at-least-32-characters-long";
(process.env as any).NODE_ENV = "test";
