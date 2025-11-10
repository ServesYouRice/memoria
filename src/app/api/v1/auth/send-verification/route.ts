/**
 * Send Email Verification API
 * POST /api/v1/auth/send-verification
 *
 * Sends a verification email to the user (or logs it in dev mode)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/api/auth';
import { errorResponse, BadRequestError } from '@/lib/errors';
import { nanoid } from 'nanoid';

const TOKEN_EXPIRY_HOURS = 24; // Token expires in 24 hours

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestError('User not found');
    }

    // Check if already verified
    if (user.emailVerified) {
      throw new BadRequestError('Email already verified');
    }

    // Generate secure token
    const token = nanoid(32);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + TOKEN_EXPIRY_HOURS);

    // Save token to database
    await prisma.emailVerificationToken.create({
      data: {
        token,
        email: user.email,
        expiresAt,
      },
    });

    // In production, send email with verification link
    // For now, log the token (development mode)
    const verifyUrl = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/auth/verify-email?token=${token}`;

    console.log('='.repeat(80));
    console.log('EMAIL VERIFICATION REQUEST');
    console.log('='.repeat(80));
    console.log('Email:', user.email);
    console.log('Verify URL:', verifyUrl);
    console.log('Token expires at:', expiresAt.toISOString());
    console.log('='.repeat(80));

    // TODO: Send email using email service
    // await sendVerificationEmail({
    //   to: user.email,
    //   verifyUrl,
    //   expiresAt,
    // });

    return NextResponse.json({
      message: 'Verification email sent. Please check your inbox.',
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
