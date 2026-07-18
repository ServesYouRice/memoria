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
import { deletePrivateUploadObject } from "@/lib/uploads/private-storage";

const logger = createLogger("users/account");

const deleteAccountSchema = z.object({
  password: z.string().min(1, "Password is required for account deletion"),
  confirmation: z.literal("DELETE", {
    message: 'Confirmation must be "DELETE"',
  }),
});

/** Export the signed-in user's portable account data without credentials or secrets. */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
        workspaces: {
          select: { id: true, name: true, createdAt: true, updatedAt: true },
        },
        canvases: {
          select: {
            id: true,
            name: true,
            workspaceId: true,
            zoomLevel: true,
            panX: true,
            panY: true,
            isPublic: true,
            isTemplate: true,
            templateDescription: true,
            templateCategory: true,
            createdAt: true,
            updatedAt: true,
            items: {
              select: {
                id: true,
                type: true,
                positionX: true,
                positionY: true,
                width: true,
                height: true,
                zIndex: true,
                content: true,
                tags: true,
                version: true,
                deletedAt: true,
                createdAt: true,
                updatedAt: true,
              },
            },
            shares: {
              select: { email: true, role: true, createdAt: true },
            },
          },
        },
      },
    });
    if (!user) throw new BadRequestError("Account not found");

    return NextResponse.json(
      { exportedAt: new Date().toISOString(), formatVersion: 1, user },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": `attachment; filename="memoria-account-${new Date().toISOString().slice(0, 10)}.json"`,
        },
      },
    );
  } catch (error) {
    return errorResponse(error, request.url);
  }
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
      select: { storageKey: true, storageMode: true },
    });

    // Use transaction for atomic deletion
    await prisma.$transaction(async (tx) => {
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

    const cleanupResults = await Promise.allSettled(
      uploadAssets.map((asset) =>
        deletePrivateUploadObject(asset.storageMode, asset.storageKey),
      ),
    );
    const failedStorageDeletes = cleanupResults.filter(
      (result) => result.status === "rejected",
    );
    if (failedStorageDeletes.length > 0) {
      logger.error(
        { userId, failedStorageDeletes: failedStorageDeletes.length },
        "Account deleted but some private upload objects require cleanup",
      );
    }

    logger.info({ userId, email }, "User account deleted");

    return NextResponse.json({
      message: "Account deleted successfully",
      success: true,
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
