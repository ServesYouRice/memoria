/**
 * User Profile API
 * PATCH /api/v1/users/profile - Update user profile
 * 
 * Following ADR-0001: API Versioning & Error Contract
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/api/auth';
import { errorResponse } from '@/lib/errors';

const updateProfileSchema = z.object({
    name: z.string().min(1).max(100).optional(),
});

/**
 * PATCH /api/v1/users/profile
 * Update user profile information
 */
export async function PATCH(request: NextRequest) {
    try {
        const { userId } = await requireAuth();
        const body = await request.json();

        // Validate input
        const data = updateProfileSchema.parse(body);

        // Update user profile
        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: {
                name: data.name,
            },
            select: {
                id: true,
                name: true,
                email: true,
                image: true,
            },
        });

        return NextResponse.json(updatedUser);
    } catch (error) {
        return errorResponse(error, request.url);
    }
}
