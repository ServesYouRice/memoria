import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCachedCanvas, setCachedCanvas, invalidateCanvasCache } from '../../src/lib/cache/canvas-cache';

// Mock redis-client
const mockRedis = {
    get: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
};

vi.mock('../../src/lib/cache/redis-client', () => ({
    getRedisClient: () => mockRedis,
}));

// Access the mock directly for assertions
const redis = mockRedis;

describe('Canvas Cache', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getCachedCanvas', () => {
        it('should return null if not in cache', async () => {
            mockRedis.get.mockResolvedValue(null);
            const result = await getCachedCanvas('canvas-1');
            expect(result).toBeNull();
            expect(redis.get).toHaveBeenCalledWith('canvas:canvas-1:data');
        });

        it('should return parsed canvas if in cache', async () => {
            const mockCanvas = { id: 'canvas-1', name: 'Test' };
            mockRedis.get.mockResolvedValue(JSON.stringify(mockCanvas));
            const result = await getCachedCanvas('canvas-1');
            expect(result).toEqual(mockCanvas);
            expect(redis.get).toHaveBeenCalledWith('canvas:canvas-1:data');
        });
    });

    describe('setCachedCanvas', () => {
        it('should set canvas in redis with expiry', async () => {
            const mockCanvas = { id: 'canvas-1', name: 'Test' };
            await setCachedCanvas({ ...mockCanvas } as any);
            expect(redis.setex).toHaveBeenCalledWith(
                'canvas:canvas-1:data',
                300, // Default 5 mins
                JSON.stringify(mockCanvas)
            );
        });
    });

    describe('invalidateCanvasCache', () => {
        it('should delete keys from redis', async () => {
            await invalidateCanvasCache('canvas-1');
            expect(redis.del).toHaveBeenCalledWith('canvas:canvas-1:data');
        });
    });
});
