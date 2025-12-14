import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RedisRateLimitStore } from '../../lib/rate-limit/stores/redis';

// Mock Redis
const mockRedis = {
    incr: vi.fn(),
    expire: vi.fn(),
    ttl: vi.fn(),
};

vi.mock('@/lib/cache/redis-client', () => ({
    getRedisClient: () => mockRedis,
}));

vi.mock('@/lib/logger', () => ({
    logger: {
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

describe('RedisRateLimitStore', () => {
    let store: RedisRateLimitStore;

    beforeEach(() => {
        vi.clearAllMocks();
        store = new RedisRateLimitStore();
    });

    it('should increment requests', async () => {
        mockRedis.incr.mockResolvedValue(1);
        mockRedis.expire.mockResolvedValue(1);

        const count = await store.increment('test-ip');

        expect(count).toBe(1);
        expect(mockRedis.incr).toHaveBeenCalledWith('rate-limit:test-ip');
        expect(mockRedis.expire).toHaveBeenCalledWith('rate-limit:test-ip', 60);
    });

    it('should not expire if count > 1', async () => {
        mockRedis.incr.mockResolvedValue(5);

        const count = await store.increment('test-ip');

        expect(count).toBe(5);
        expect(mockRedis.expire).not.toHaveBeenCalled();
    });

    it('should handle redis failure gracefully (fail open)', async () => {
        mockRedis.incr.mockRejectedValue(new Error('Redis down'));

        // Should catch error and return 0 (effectively allowing request)
        const count = await store.increment('test-ip');

        expect(count).toBe(0);
    });
});
