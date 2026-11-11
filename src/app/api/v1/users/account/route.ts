/**
 * Delete Account API
 * DELETE /api/v1/users/account - Delete user account and all associated data
 *
 * Following ADR-0001: API Versioning & Error Contract
 * Following best practices for data deletion (cascade all user data)
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { getCredentialPasswordHash } from "@/lib/auth/credentials";
import { requireAuth } from "@/lib/api/auth";
import { errorResponse, BadRequestError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { enqueueUploadDeletion } from "@/lib/uploads/lifecycle";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";
import { enqueueThumbnailDeletion } from "@/lib/thumbnails/outbox-handler";
import { UploadAssetStatus } from "@/generated/prisma/client";

const logger = createLogger("users/account");

/**
 * Account deletion is one interactive transaction, so it gets its own limits
 * instead of Prisma's 5 s default. Measured on a local PostgreSQL 16 shared
 * with other load: 200 canvases of 200 items took about 4.3 s, and the full
 * LAUNCH_LIMITS fixture (500 uploads, 200 canvases of 2,000 items, 1,000
 * foreign items) about 18 s. The timeout leaves roughly 3x headroom over
 * that; maxWait bounds the wait for a pooled connection.
 */
const ACCOUNT_DELETION_TRANSACTION = {
  timeout: 60_000,
  maxWait: 10_000,
} as const;

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

    // Get the credential password hash
    const passwordHash = await getCredentialPasswordHash(prisma, userId);

    if (!passwordHash) {
      throw new BadRequestError("Cannot delete this account type");
    }

    // Verify password
    const isValidPassword = await verifyPassword(passwordHash, data.password);
    if (!isValidPassword) {
      throw new BadRequestError("Password is incorrect");
    }

    const accountExports = await prisma.accountExport.findMany({
      where: { userId, storageKey: { not: null } },
      select: { id: true, storageMode: true, storageKey: true },
    });

    // Use transaction for atomic deletion
    await prisma.$transaction(async (tx) => {
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
        select: { id: true, thumbnailKey: true },
      });
      const canvasIds = userCanvases.map((c) => c.id);
      // The canvases go below; their stored thumbnails would be orphaned.
      for (const canvas of userCanvases) {
        if (canvas.thumbnailKey) {
          await enqueueThumbnailDeletion(tx, canvas.thumbnailKey);
        }
      }

      // Every upload that goes with the account: the user's own, and those
      // collaborators added to the user's canvases (the canvas delete below
      // would cascade their rows away without a cleanup job or a quota
      // release). Queued before any canvas is deleted.
      const uploadAssets = await tx.uploadAsset.findMany({
        where: {
          status: { not: UploadAssetStatus.DELETED },
          OR: [{ userId }, { canvasId: { in: canvasIds } }],
        },
        select: {
          id: true,
          userId: true,
          size: true,
          status: true,
          canvas: { select: { userId: true } },
        },
      });
      // The user's uploads that back items kept on another owner's canvas
      // move to that owner with the items; all others are deleted.
      const isForeignActive = (asset: (typeof uploadAssets)[number]) =>
        asset.userId === userId &&
        asset.status === UploadAssetStatus.ACTIVE &&
        !!asset.canvas &&
        asset.canvas.userId !== userId;
      const transferredAssets = uploadAssets.filter(isForeignActive);
      const deletedAssets = uploadAssets.filter(
        (asset) => !isForeignActive(asset),
      );
      for (const asset of transferredAssets) {
        const newOwnerId = asset.canvas.userId;
        // Conditional, so an asset that stopped being ACTIVE concurrently is
        // deleted with the account instead of transferred.
        const moved = await tx.uploadAsset.updateMany({
          where: { id: asset.id, userId, status: UploadAssetStatus.ACTIVE },
          data: { userId: newOwnerId },
        });
        if (moved.count !== 1) {
          await enqueueUploadDeletion(tx, asset.id, { cascade: true });
          continue;
        }
        // The canvas owner now carries the bytes. The limit is not enforced:
        // the upload already exists and the owner's items display it.
        await tx.$executeRaw`
          INSERT INTO "UploadQuota" ("userId", "assetCount", "totalBytes", "updatedAt")
          VALUES (${newOwnerId}, 1, ${BigInt(asset.size)}, NOW())
          ON CONFLICT ("userId") DO UPDATE SET
            "assetCount" = "UploadQuota"."assetCount" + 1,
            "totalBytes" = "UploadQuota"."totalBytes" + EXCLUDED."totalBytes",
            "updatedAt" = NOW()
        `;
      }
      for (const asset of deletedAssets) {
        await enqueueUploadDeletion(tx, asset.id, { cascade: true });
      }

      // Preserve content contributed to another owner's canvas by
      // transferring immutable authorship to that canvas owner. Optional
      // update/delete attribution can safely be cleared.
      // One statement per distinct foreign owner, not one per item.
      const foreignOwners = await tx.canvas.findMany({
        where: {
          userId: { not: userId },
          items: { some: { createdById: userId } },
        },
        select: { userId: true },
        distinct: ["userId"],
      });
      for (const { userId: ownerId } of foreignOwners) {
        await tx.canvasItem.updateMany({
          where: { createdById: userId, canvas: { userId: ownerId } },
          data: { createdById: ownerId },
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

      // Delete accounts (credential and any linked providers)
      await tx.account.deleteMany({
        where: { userId },
      });

      // Passkeys and two-factor secrets also cascade from the user row; the
      // explicit deletes keep this list a complete record of what goes.
      await tx.passkey.deleteMany({ where: { userId } });
      await tx.twoFactor.deleteMany({ where: { userId } });
      // Trusted-device and pending two-factor challenges store the user id.
      await tx.verification.deleteMany({ where: { value: userId } });

      // Delete the user
      await tx.user.delete({
        where: { id: userId },
      });
    }, ACCOUNT_DELETION_TRANSACTION);

    logger.info({ userId, email }, "User account deleted");

    return NextResponse.json({
      message: "Account deleted successfully",
      success: true,
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
