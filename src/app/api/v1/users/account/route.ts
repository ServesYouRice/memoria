/**
 * Delete Account API
 * DELETE /api/v1/users/account - Delete user account and all associated data
 *
 * Following ADR-0001: API Versioning & Error Contract
 * Following best practices for data deletion (cascade all user data)
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import * as argon2 from "argon2";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api/auth";
import { errorResponse, BadRequestError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { enqueueUploadDeletion } from "@/lib/uploads/lifecycle";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";

const logger = createLogger("users/account");

const deleteAccountSchema = z.object({
  password: z.string().min(1, "Password is required for account deletion"),
  confirmation: z.literal("DELETE", {
    message: 'Confirmation must be "DELETE"',
  }),
});

/** The former synchronous export was removed because it was unbounded. */
export async function GET() {
  return NextResponse.json(
    {
      type: "https://memoria.local/errors/background-export-required",
      title: "Background export required",
      status: 405,
      detail: "Create an export with POST /api/v1/users/account/exports.",
    },
    {
      status: 405,
      headers: {
        Allow: "DELETE",
        "Cache-Control": "private, no-store",
        "Content-Type": "application/problem+json",
      },
    },
  );
}

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
      throw new BadRequestError("Cannot delete this account type");
    }

    // Verify password
    const isValidPassword = await argon2.verify(
      user.passwordHash,
      data.password,
    );
    if (!isValidPassword) {
      throw new BadRequestError("Password is incorrect");
    }

    const uploadAssets = await prisma.uploadAsset.findMany({
      where: { userId },
      select: { id: true },
    });
    const accountExports = await prisma.accountExport.findMany({
      where: { userId, storageKey: { not: null } },
      select: { id: true, storageMode: true, storageKey: true },
    });

    // Use transaction for atomic deletion
    await prisma.$transaction(async (tx) => {
      for (const asset of uploadAssets) {
        await enqueueUploadDeletion(tx, asset.id);
      }
      for (const accountExport of accountExports) {
        await enqueueOutboxJob(tx, {
          type: "account-export.delete",
          dedupeKey: `account-export.account-delete:${accountExport.id}`,
          payload: {
            storageMode: accountExport.storageMode,
            storageKey: accountExport.storageKey!,
          },
        });
      }
      // Get all user's canvases
      const userCanvases = await tx.canvas.findMany({
        where: { userId },
        select: { id: true },
      });
      const canvasIds = userCanvases.map((c) => c.id);

      // Preserve content contributed to another owner's canvas by
      // transferring immutable authorship to that canvas owner. Optional
      // update/delete attribution can safely be cleared.
      const foreignItems = await tx.canvasItem.findMany({
        where: { createdById: userId, canvas: { userId: { not: userId } } },
        select: { id: true, canvas: { select: { userId: true } } },
      });
      for (const item of foreignItems) {
        await tx.canvasItem.update({
          where: { id: item.id },
          data: { createdById: item.canvas.userId },
        });
      }
      await tx.canvasItem.updateMany({
        where: { updatedById: userId },
        data: { updatedById: null },
      });
      await tx.canvasItem.updateMany({
        where: { deletedById: userId },
        data: { deletedById: null },
      });

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
        where: {
          OR: [{ canvasId: { in: canvasIds } }, { email: email.toLowerCase() }],
        },
      });

      await tx.passwordResetToken.deleteMany({ where: { email } });
      await tx.emailVerificationToken.deleteMany({ where: { email } });
      await tx.idempotencyKey.deleteMany({ where: { userId } });

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

    logger.info({ userId, email }, "User account deleted");

    return NextResponse.json({
      message: "Account deleted successfully",
      success: true,
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
