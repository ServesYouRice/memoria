/**
 * Change Password API
 * POST /api/v1/users/change-password - Change user password
 *
 * Following ADR-0001: API Versioning & Error Contract
 * Following ADR-0008: Auth, Session & CSRF Policy
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api/auth";
import { errorResponse, BadRequestError } from "@/lib/errors";
import {
  PASSWORD_MIN_LENGTH,
  validatePasswordStrength,
} from "@/lib/validation/password";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { invalidateSessionVersion } from "@/lib/api/session-cache";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z
    .string()
    .min(
      PASSWORD_MIN_LENGTH,
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
    )
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
      select: { passwordHash: true, email: true, name: true },
    });

    if (!user?.passwordHash) {
      throw new BadRequestError("Cannot change password for this account type");
    }

    // Verify current password
    const isValidPassword = await verifyPassword(
      user.passwordHash,
      data.currentPassword,
    );
    if (!isValidPassword) {
      throw new BadRequestError("Current password is incorrect");
    }

    // Prevent using the same password
    const isSamePassword = await verifyPassword(
      user.passwordHash,
      data.newPassword,
    );
    if (isSamePassword) {
      throw new BadRequestError(
        "New password must be different from current password",
      );
    }

    const strength = await validatePasswordStrength(data.newPassword, [
      user.email,
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
    const hashedPassword = await hashPassword(data.newPassword);

    // Rotate the security stamp and remove database sessions in the same
    // transaction so every existing cookie is invalid after this change.
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash: hashedPassword,
          sessionVersion: { increment: 1 },
        },
      });
      await tx.session.deleteMany({ where: { userId } });
    });
    await invalidateSessionVersion(userId);

    return NextResponse.json({ message: "Password changed successfully" });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
