/**
 * Rate Limiting Type Definitions
 * Defines interfaces for pluggable rate limiting strategies
 */

export interface RateLimitConfig {
  /**
   * Maximum number of requests allowed in the window
   */
  maxRequests: number;

  /**
   * Time window in seconds
   */
  windowSeconds: number;

  /**
   * Optional: Custom identifier function
   * Defaults to IP address
   */
  identifier?: (request: Request) => string | Promise<string>;

  /**
   * Optional: Custom key prefix
   * Defaults to 'ratelimit'
   */
  keyPrefix?: string;
}

export interface RateLimitResult {
  /**
   * Whether the request is allowed
   */
  allowed: boolean;

  /**
   * Number of requests made in current window
   */
  current: number;

  /**
   * Maximum requests allowed
   */
  limit: number;

  /**
   * Remaining requests in current window
   */
  remaining: number;

  /**
   * Unix timestamp when the limit resets
   */
  resetAt: number;

  /**
   * Time until reset in seconds
   */
  resetIn: number;
}

export interface RateLimiter {
  /**
   * Check and consume a rate limit token
   */
  check(identifier: string): Promise<RateLimitResult>;

  /**
   * Reset rate limit for identifier
   */
  reset(identifier: string): Promise<void>;

  /**
   * Get current rate limit status without consuming
   */
  status(identifier: string): Promise<RateLimitResult>;
}

/**
 * Rate limit store interface
 */
export interface RateLimitStore {
  /**
   * Increment counter for key
   * Returns current count and TTL
   */
  increment(
    key: string,
    windowSeconds: number,
  ): Promise<{ count: number; ttl: number }>;

  /**
   * Get current count for key
   */
  get(key: string): Promise<number | null>;

  /**
   * Delete key
   */
  delete(key: string): Promise<void>;
}
