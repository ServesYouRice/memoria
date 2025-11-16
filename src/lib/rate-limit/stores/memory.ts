/**
 * In-Memory Rate Limit Store
 * For development and testing only - not suitable for production with multiple servers
 */

import type { RateLimitStore } from '../types';

interface MemoryEntry {
  count: number;
  expiresAt: number;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private store: Map<string, MemoryEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  async increment(key: string, windowSeconds: number): Promise<{ count: number; ttl: number }> {
    const now = Date.now();
    const entry = this.store.get(key);

    if (entry && entry.expiresAt > now) {
      // Entry exists and not expired - increment
      entry.count++;
      const ttl = Math.ceil((entry.expiresAt - now) / 1000);
      return { count: entry.count, ttl };
    }

    // Entry expired or doesn't exist - create new
    const expiresAt = now + windowSeconds * 1000;
    this.store.set(key, { count: 1, expiresAt });
    return { count: 1, ttl: windowSeconds };
  }

  async get(key: string): Promise<number | null> {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || entry.expiresAt <= now) {
      return null;
    }

    return entry.count;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Destroy store and clear interval
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }

  /**
   * Get current store size (for testing)
   */
  size(): number {
    return this.store.size;
  }
}
