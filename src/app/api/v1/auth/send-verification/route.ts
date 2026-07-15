/**
 * Send Email Verification API
 * POST /api/v1/auth/send-verification
 *
 * Sends a verification email to the user
 */

import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendEmailVerification } from "@/lib/email";
import { requireAuth } from "@/lib/api/auth";
import { errorResponse, BadRequestError } from "@/lib/errors";
import { nanoid } from "nanoid";
import { createHash } from "crypto";

const TOKEN_EXPIRY_HOURS = 24; // Token expires in 24 hours

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestError("User not found");
    }

    // Check if already verified
    if (user.emailVerified) {
      throw new BadRequestError("Email already verified");
    }

    // Generate secure token
    const token = nanoid(32);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + TOKEN_EXPIRY_HOURS);

    // Save token to database
    await prisma.emailVerificationToken.create({
      data: {
        token: createHash("sha256").update(token).digest("hex"),
        email: user.email,
        expiresAt,
      },
    });

    // Send verification email
    const baseUrl =
      process.env.AUTH_URL ||
      process.env.NEXTAUTH_URL ||
      request.nextUrl.origin;
    const verifyUrl = `${baseUrl}/auth/verify-email?token=${token}`;

    try {
      await sendEmailVerification(
        { email: user.email, name: user.name || undefined },
        {
          userName: user.name || "User",
          verificationUrl: verifyUrl,
          expiresIn: `${TOKEN_EXPIRY_HOURS} hours`,
        },
      );

      logger.info({ email: user.email }, "Verification email sent");
    } catch (emailError) {
      // Log error but don't fail the request
      logger.error(
        { error: emailError, email: user.email },
        "Failed to send verification email",
      );
      // Still return success to user (they can retry later)
    }

    return NextResponse.json({
      message: "Verification email sent. Please check your inbox.",
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
