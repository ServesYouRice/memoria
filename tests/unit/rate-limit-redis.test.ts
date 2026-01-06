import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RedisRateLimitStore } from '@/lib/rate-limit/stores/redis';

const execMock = vi.fn();
const expireMock = vi.fn();
const onMock = vi.fn();

vi.mock('ioredis', () => ({
    default: class RedisMock {
        on = onMock;
        expire = expireMock;
        multi() {
            return {
                incr: vi.fn().mockReturnThis(),
                ttl: vi.fn().mockReturnThis(),
                exec: execMock,
            };
        }
    },
}));

vi.mock('@/lib/logger', () => ({
    logger: {
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
    },
}));

describe('RedisRateLimitStore', () => {
    let store: RedisRateLimitStore;

    beforeEach(() => {
        vi.clearAllMocks();
        store = new RedisRateLimitStore({ host: 'localhost', port: 6379, keyPrefix: 'rate-limit:' });
    });

    it('should increment requests', async () => {
        execMock.mockResolvedValueOnce([[null, 1], [null, -1]]);
        expireMock.mockResolvedValueOnce(1);

        const result = await store.increment('test-ip', 60);

        expect(result.count).toBe(1);
        expect(result.ttl).toBe(60);
        expect(expireMock).toHaveBeenCalledWith('rate-limit:test-ip', 60);
    });

    it('should not expire if count > 1', async () => {
        execMock.mockResolvedValueOnce([[null, 5], [null, 30]]);

        const result = await store.increment('test-ip', 60);

        expect(result.count).toBe(5);
        expect(result.ttl).toBe(30);
        expect(expireMock).not.toHaveBeenCalled();
    });

    it('should surface redis failures', async () => {
        execMock.mockRejectedValueOnce(new Error('Redis down'));

        await expect(store.increment('test-ip', 60)).rejects.toThrow('Redis down');
    });
});
