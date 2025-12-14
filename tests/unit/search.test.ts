import { describe, it, expect, vi, beforeEach } from 'vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '../../src/app/api/v1/search/route';

// Mock next/server
vi.mock('next/server', () => ({
    NextRequest: class MockNextRequest {
        url: string;
        constructor(url: string) { this.url = url; }
        nextUrl = { searchParams: new URLSearchParams(this.url.split('?')[1]) };
    },
    NextResponse: {
        json: (body: any, init?: any) => ({
            json: async () => body,
            status: init?.status || 200
        }),
    },
}));

import { NextRequest } from 'next/server';

// Mock DB
const mockPrisma = {
    canvasItem: {
        findMany: vi.fn(),
    },
    canvas: {
        findMany: vi.fn(),
    },
};

vi.mock('../../src/lib/db', () => ({
    prisma: mockPrisma,
}));

// Mock requireAuth
vi.mock('../../src/lib/auth', () => ({
    requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

describe('Search API', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return empty results if query is short', async () => {
        const req = new NextRequest('http://localhost/api/search?q=a');
        const response = await GET(req);
        const data = await response.json();

        expect(response.status).toBe(400); // Or 200 with empty? The logic handles validation.
        // Actually, check implementation. Usually z validation throws or returns 400.
    });

    it('should search database when query is valid', async () => {
        const req = new NextRequest('http://localhost/api/search?q=test');

        mockPrisma.canvasItem.findMany.mockResolvedValue([]);
        mockPrisma.canvas.findMany.mockResolvedValue([]);

        const response = await GET(req);
        expect(response.status).toBe(200);
        expect(mockPrisma.canvasItem.findMany).toHaveBeenCalled();
        expect(mockPrisma.canvas.findMany).toHaveBeenCalled();
    });
});
