/**
 * Forgot Password API
 * POST /api/v1/auth/forgot-password
 *
 * Generates a password reset token and sends it via email (or logs it in dev mode)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { errorResponse } from '@/lib/errors';
import { z } from 'zod';
import { nanoid } from 'nanoid';

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

const TOKEN_EXPIRY_HOURS = 1; // Token expires in 1 hour

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = forgotPasswordSchema.parse(body);

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    // Always return success to prevent email enumeration attacks
    // But only send email if user exists
    if (user) {
      // Generate secure token
      const token = nanoid(32); // 32-character random token
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + TOKEN_EXPIRY_HOURS);

      // Save token to database
      await prisma.passwordResetToken.create({
        data: {
          token,
          email: email.toLowerCase(),
          expiresAt,
        },
      });

      // In production, send email with reset link
      // For now, log the token (development mode)
      const resetUrl = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/auth/reset-password?token=${token}`;

      console.log('='.repeat(80));
      console.log('PASSWORD RESET REQUEST');
      console.log('='.repeat(80));
      console.log('Email:', email);
      console.log('Reset URL:', resetUrl);
      console.log('Token expires at:', expiresAt.toISOString());
      console.log('='.repeat(80));

      // TODO: Send email using email service (SendGrid, AWS SES, etc.)
      // Example:
      // await sendPasswordResetEmail({
      //   to: email,
      //   resetUrl,
      //   expiresAt,
      // });
    }

    // Always return success (security best practice)
    return NextResponse.json({
      message: 'If an account exists with this email, you will receive password reset instructions.',
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
