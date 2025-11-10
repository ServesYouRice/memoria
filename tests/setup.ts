import { beforeAll, afterAll, vi } from 'vitest';

// Mock HTMLCanvasElement for Konva tests
if (typeof HTMLCanvasElement !== 'undefined') {
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

  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => '');
  HTMLCanvasElement.prototype.toBlob = vi.fn();
}

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn(() => ({
  disconnect: vi.fn(),
  observe: vi.fn(),
  takeRecords: vi.fn(),
  unobserve: vi.fn(),
})) as any;

beforeAll(async () => {
  // Setup test database if needed
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/canvascollect_test';
  process.env.DEMO_USER_ID = 'test-user-id';
  process.env.NODE_ENV = 'test';
});

afterAll(async () => {
  // Cleanup
});
