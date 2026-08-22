import { afterAll, vi } from "vitest";

// `src/lib/env.ts` reads and validates `process.env` at module scope, so these
// have to be in place before the test file's imports are evaluated. A
// `beforeAll` hook runs too late: the suite has already imported its module
// graph by then, and any module reaching env.ts throws during collection.
const dbPassword = process.env.DATABASE_PASSWORD || "devpassword";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  `postgresql://memoria:${dbPassword}@localhost:5432/memoria`;
process.env.DEMO_USER_ID = "test-user-id";
process.env.NODE_ENV = "test";
process.env.AUTH_URL = process.env.AUTH_URL || "http://localhost:3000";
process.env.AUTH_SECRET =
  process.env.AUTH_SECRET || "test-auth-secret-0123456789abcdef-placeholder";

// Mock HTMLCanvasElement for Konva tests
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    getImageData: vi.fn(() => ({
      data: new Array(4),
    })),
    putImageData: vi.fn(),
    createImageData: vi.fn(() => []),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    fillText: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    transform: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
  })) as any;

  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "");
  HTMLCanvasElement.prototype.toBlob = vi.fn();
}

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn(() => ({
  disconnect: vi.fn(),
  observe: vi.fn(),
  takeRecords: vi.fn(),
  unobserve: vi.fn(),
})) as any;

afterAll(async () => {
  // Cleanup
});
