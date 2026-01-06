/**
 * Delete Account API
 * DELETE /api/v1/users/account - Delete user account and all associated data
 * 
 * Following ADR-0001: API Versioning & Error Contract
 * Following best practices for data deletion (cascade all user data)
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import * as argon2 from 'argon2';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/api/auth';
import { errorResponse, BadRequestError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';

const logger = createLogger('users/account');

const deleteAccountSchema = z.object({
    password: z.string().min(1, 'Password is required for account deletion'),
    confirmation: z.literal('DELETE', { message: 'Confirmation must be "DELETE"' }),
});

/**
 * DELETE /api/v1/users/account
 * Permanently delete user account and all associated data
 * 
 * This operation:
 * 1. Verifies user password
 * 2. Deletes all user canvases (cascades to items, shares, versions)
 * 3. Deletes all user sessions
 * 4. Deletes the user account
 */
export async function DELETE(request: NextRequest) {
    try {
        const { userId, email } = await requireAuth();
        const body = await request.json();

        // Validate input
        const data = deleteAccountSchema.parse(body);

        // Get user with password
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { passwordHash: true },
        });

        if (!user?.passwordHash) {
            throw new BadRequestError('Cannot delete this account type');
        }

        // Verify password
        const isValidPassword = await argon2.verify(user.passwordHash, data.password);
        if (!isValidPassword) {
            throw new BadRequestError('Password is incorrect');
        }

        // Use transaction for atomic deletion
        await prisma.$transaction(async (tx) => {
            // Get all user's canvases
            const userCanvases = await tx.canvas.findMany({
                where: { userId },
                select: { id: true },
            });
            const canvasIds = userCanvases.map(c => c.id);

            // Delete canvas items for all user's canvases
            await tx.canvasItem.deleteMany({
                where: { canvasId: { in: canvasIds } },
            });

            // Delete canvas versions
            await tx.canvasVersion.deleteMany({
                where: { canvasId: { in: canvasIds } },
            });

            // Delete canvas shares
            await tx.canvasShare.deleteMany({
                where: { canvasId: { in: canvasIds } },
            });

            // Delete comments on user's items
            await tx.comment.deleteMany({
                where: { userId },
            });

            // Delete canvases
            await tx.canvas.deleteMany({
                where: { userId },
            });

            // Delete activities
            await tx.activity.deleteMany({
                where: { userId },
            });

            // Delete sessions
            await tx.session.deleteMany({
                where: { userId },
            });

            // Delete accounts (OAuth)
            await tx.account.deleteMany({
                where: { userId },
            });

            // Delete the user
            await tx.user.delete({
                where: { id: userId },
            });
        });

        logger.info({ userId, email }, 'User account deleted');

        return NextResponse.json({
            message: 'Account deleted successfully',
            success: true,
        });
    } catch (error) {
        return errorResponse(error, request.url);
    }
}
