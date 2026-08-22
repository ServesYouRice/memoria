/**
 * Verify Email API
 * POST /api/v1/auth/verify-email
 *
 * Verifies user email using a valid verification token
 */

import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, BadRequestError, NotFoundError } from "@/lib/errors";
import { z } from "zod";
import { createHash } from "crypto";

const verifyEmailSchema = z.object({
  token: z.string().min(1, "Token is required"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token } = verifyEmailSchema.parse(body);
    const tokenHash = createHash("sha256").update(token).digest("hex");

    // Find valid token
    const verificationToken = await prisma.emailVerificationToken.findUnique({
      where: { token: tokenHash },
    });

    if (!verificationToken) {
      throw new NotFoundError("Invalid or expired verification token");
    }

    // Check if token is expired
    if (new Date() > verificationToken.expiresAt) {
      throw new BadRequestError("Verification token has expired");
    }

    // Check if token has already been used
    if (verificationToken.usedAt) {
      throw new BadRequestError("Verification token has already been used");
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: verificationToken.email },
    });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    // Check if already verified
    if (user.emailVerified) {
      return NextResponse.json({
        message: "Email already verified",
      });
    }

    // Mark email as verified and mark token as used with atomic compare-and-set
    await prisma.$transaction(async (tx) => {
      const tokenUpdate = await tx.emailVerificationToken.updateMany({
        where: { id: verificationToken.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (tokenUpdate.count !== 1) {
        throw new BadRequestError("Verification token has already been used");
      }
      await tx.user.update({
        where: { id: user.id },
        data: { emailVerified: new Date() },
      });
    });

    return NextResponse.json({
      message: "Email verified successfully!",
      redirectTo: "/auth/login?verified=1",
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
