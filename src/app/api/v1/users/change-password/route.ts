/**
 * Change Password API
 * POST /api/v1/users/change-password - Change user password
 * 
 * Following ADR-0001: API Versioning & Error Contract
 * Following ADR-0008: Auth, Session & CSRF Policy
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import * as argon2 from 'argon2';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/api/auth';
import { errorResponse, BadRequestError } from '@/lib/errors';
import { MIN_PASSWORD_LENGTH } from '@/lib/constants';

const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string()
        .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
        .max(128),
});

/**
 * POST /api/v1/users/change-password
 * Change the authenticated user's password
 */
export async function POST(request: NextRequest) {
    try {
        const { userId } = await requireAuth();
        const body = await request.json();

        // Validate input
        const data = changePasswordSchema.parse(body);

        // Get user with current password
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { passwordHash: true },
        });

        if (!user?.passwordHash) {
            throw new BadRequestError('Cannot change password for this account type');
        }

        // Verify current password
        const isValidPassword = await argon2.verify(user.passwordHash, data.currentPassword);
        if (!isValidPassword) {
            throw new BadRequestError('Current password is incorrect');
        }

        // Prevent using the same password
        const isSamePassword = await argon2.verify(user.passwordHash, data.newPassword);
        if (isSamePassword) {
            throw new BadRequestError('New password must be different from current password');
        }

        // Hash new password
        const hashedPassword = await argon2.hash(data.newPassword, {
            type: argon2.argon2id,
            memoryCost: 65536,
            timeCost: 3,
            parallelism: 4,
        });

        // Update password
        await prisma.user.update({
            where: { id: userId },
            data: { passwordHash: hashedPassword },
        });

        return NextResponse.json({ message: 'Password changed successfully' });
    } catch (error) {
        return errorResponse(error, request.url);
    }
}
