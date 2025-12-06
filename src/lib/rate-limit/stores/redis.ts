/**
 * Redis Rate Limit Store
 * Production-ready store using Redis for distributed rate limiting
 *
 * Note: This is a template implementation. To use in production:
 * 1. Install ioredis: pnpm add ioredis @types/ioredis
 * 2. Configure Redis connection in environment variables
 */

import { logger } from '@/lib/logger';
import type { RateLimitStore } from '../types';

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
}

export class RedisRateLimitStore implements RateLimitStore {
  private config: RedisConfig;

  constructor(config: RedisConfig) {
    this.config = config;
  }

  async increment(key: string, windowSeconds: number): Promise<{ count: number; ttl: number }> {
    throw new Error(
      'Redis rate limiting requires ioredis. Install with: pnpm add ioredis @types/ioredis'
    );
  }

  async get(key: string): Promise<number | null> {
    throw new Error(
      'Redis rate limiting requires ioredis. Install with: pnpm add ioredis @types/ioredis'
    );
  }

  async delete(key: string): Promise<void> {
    throw new Error(
      'Redis rate limiting requires ioredis. Install with: pnpm add ioredis @types/ioredis'
    );
  }

  async close(): Promise<void> {
    // No-op
  }

  async ping(): Promise<boolean> {
    return false;
  }
}
