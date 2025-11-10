/**
 * Reset Password API
 * POST /api/v1/auth/reset-password
 *
 * Resets user password using a valid reset token
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { errorResponse, BadRequestError, NotFoundError } from '@/lib/errors';
import { hash } from 'argon2';
import { z } from 'zod';

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, password } = resetPasswordSchema.parse(body);

    // Find valid token
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
    });

    if (!resetToken) {
      throw new NotFoundError('Invalid or expired reset token');
    }

    // Check if token is expired
    if (new Date() > resetToken.expiresAt) {
      throw new BadRequestError('Reset token has expired');
    }

    // Check if token has already been used
    if (resetToken.usedAt) {
      throw new BadRequestError('Reset token has already been used');
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: resetToken.email },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Hash new password
    const passwordHash = await hash(password);

    // Update password and mark token as used
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return NextResponse.json({
      message: 'Password reset successful. You can now login with your new password.',
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
