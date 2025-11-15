/**
 * Health API Tests
 *
 * FIXED: Issue #21 - Missing API endpoint tests
 *
 * Tests for the /api/health endpoint
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { GET } from '@/app/api/health/route';
import { prisma } from '@/lib/db';

describe('/api/health', () => {
  describe('GET', () => {
    it('should return healthy status when database is accessible', async () => {
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('status');
      expect(data.status).toBe('healthy');
      expect(data).toHaveProperty('timestamp');
      expect(data).toHaveProperty('version');
      expect(data).toHaveProperty('uptime');
      expect(data).toHaveProperty('checks');
    });

    it('should include database check', async () => {
      const response = await GET();
      const data = await response.json();

      expect(data.checks).toHaveProperty('database');
      expect(data.checks.database).toHaveProperty('status');
      expect(data.checks.database.status).toBe('pass');
      expect(data.checks.database).toHaveProperty('responseTime');
      expect(typeof data.checks.database.responseTime).toBe('number');
    });

    it('should include memory check', async () => {
      const response = await GET();
      const data = await response.json();

      expect(data.checks).toHaveProperty('memory');
      expect(data.checks.memory).toHaveProperty('status');
      expect(['pass', 'warn', 'fail']).toContain(data.checks.memory.status);
      expect(data.checks.memory).toHaveProperty('percentage');
      expect(data.checks.memory).toHaveProperty('used');
      expect(data.checks.memory).toHaveProperty('total');
      expect(data.checks.memory).toHaveProperty('rss');
      expect(data.checks.memory).toHaveProperty('external');
    });

    it('should include API version', async () => {
      const response = await GET();
      const data = await response.json();

      expect(data).toHaveProperty('version');
      expect(typeof data.version).toBe('string');
      expect(data.version).toMatch(/^\d+\.\d+\.\d+$/); // Semver format
    });

    it('should include uptime', async () => {
      const response = await GET();
      const data = await response.json();

      expect(data).toHaveProperty('uptime');
      expect(typeof data.uptime).toBe('number');
      expect(data.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should set no-cache headers', async () => {
      const response = await GET();

      expect(response.headers.get('Cache-Control')).toBe(
        'no-cache, no-store, must-revalidate'
      );
      expect(response.headers.get('Pragma')).toBe('no-cache');
      expect(response.headers.get('Expires')).toBe('0');
    });

    it('should return degraded status when memory usage is high', async () => {
      // This test is probabilistic - it only runs if memory is actually high
      const response = await GET();
      const data = await response.json();

      if (data.checks.memory.status === 'warn') {
        expect(data.status).toBe('degraded');
      }

      if (data.checks.memory.status === 'fail') {
        expect(data.status).toBe('unhealthy');
      }
    });
  });
});
