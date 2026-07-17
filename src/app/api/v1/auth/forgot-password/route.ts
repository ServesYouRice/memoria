/**
 * Forgot Password API Route
 *
 * Handles password reset requests by generating a secure token and sending
 * a password reset email. Implements security best practices including:
 * - Email enumeration prevention (always returns success)
 * - Secure token generation using nanoid
 * - Token expiration (1 hour by default)
 * - Graceful email failure handling
 *
 * @module app/api/v1/auth/forgot-password
 *
 * ## Endpoint
 * POST /api/v1/auth/forgot-password
 *
 * ## Request Body
 * ```json
 * {
 *   "email": "user@example.com"
 * }
 * ```
 *
 * ## Response
 * ```json
 * {
 *   "message": "If an account exists with this email, you will receive password reset instructions."
 * }
 * ```
 *
 * ## Security Notes
 * - Always returns success to prevent email enumeration attacks
 * - Only sends email if user actually exists in database
 * - Token is 32 characters of secure random data
 * - Email failures are logged but don't affect the response
 *
 * @see {@link sendPasswordResetEmail} for email template details
 */

import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendPasswordResetEmail } from "@/lib/email";
import { errorResponse } from "@/lib/errors";
import { z } from "zod";
import { nanoid } from "nanoid";
import { createHash } from "crypto";

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
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
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + TOKEN_EXPIRY_HOURS);

      // Save token to database
      await prisma.passwordResetToken.create({
        data: {
          token: tokenHash,
          email: email.toLowerCase(),
          expiresAt,
        },
      });

      // Send password reset email
      const baseUrl =
        process.env.AUTH_URL ||
        process.env.NEXTAUTH_URL ||
        request.nextUrl.origin;
      const resetUrl = `${baseUrl}/auth/reset-password?token=${token}`;

      try {
        await sendPasswordResetEmail(
          { email: email.toLowerCase(), name: user.name || undefined },
          {
            userName: user.name || "User",
            resetUrl,
            expiresIn: `${TOKEN_EXPIRY_HOURS} hour${TOKEN_EXPIRY_HOURS > 1 ? "s" : ""}`,
          },
        );

        logger.info(
          { email: email.toLowerCase() },
          "Password reset email sent",
        );
      } catch (emailError) {
        // Log error but don't fail the request (security: don't reveal if email failed)
        logger.error(
          { error: emailError, email: email.toLowerCase() },
          "Failed to send password reset email",
        );
      }
    }

    // Always return success (security best practice)
    return NextResponse.json({
      message:
        "If an account exists with this email, you will receive password reset instructions.",
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
