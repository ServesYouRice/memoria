/**
 * Reset Password API
 * POST /api/v1/auth/reset-password
 *
 * Resets user password using a valid reset token
 */

import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, BadRequestError, NotFoundError } from "@/lib/errors";
import { z } from "zod";
import { hashPassword } from "@/lib/auth/password";
import { validatePasswordStrength } from "@/lib/validation/password";
import { createHash } from "crypto";

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Token is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, password } = resetPasswordSchema.parse(body);
    const tokenHash = createHash("sha256").update(token).digest("hex");

    // Find valid token
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token: tokenHash },
    });

    if (!resetToken) {
      throw new NotFoundError("Invalid or expired reset token");
    }

    // Check if token is expired
    if (new Date() > resetToken.expiresAt) {
      throw new BadRequestError("Reset token has expired");
    }

    // Check if token has already been used
    if (resetToken.usedAt) {
      throw new BadRequestError("Reset token has already been used");
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: resetToken.email },
    });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    const strength = await validatePasswordStrength(password, [
      resetToken.email,
      user.name || "",
    ]);
    if (!strength.isValid) {
      const suggestions = strength.feedback.suggestions.join(" ");
      throw new BadRequestError(
        [strength.feedback.warning || "Password is too weak.", suggestions]
          .filter(Boolean)
          .join(" ")
          .trim(),
      );
    }

    // Hash new password
    const passwordHash = await hashPassword(password);

    // Update password and mark token as used
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: {
          id: resetToken.id,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new BadRequestError("Reset token has already been used");
      }
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });
    });

    return NextResponse.json({
      message:
        "Password reset successful. You can now login with your new password.",
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
