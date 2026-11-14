/**
 * Direct upload presign (IMP-152).
 *
 * POST `{ canvasId, filename, contentType, size }`: reserve the upload
 * against the user's quota and return a short-lived signed PUT that sends
 * the file straight to object storage. The browser then calls
 * `/api/v1/upload/direct/confirm`. Only with S3 storage: otherwise this
 * answers 409 `direct-upload-unavailable` and the client uses
 * `/api/v1/upload` instead.
 *
 * Canvas EDIT access, the type list and the size cap are checked here and
 * again on confirm against the stored object.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthValidation } from "@/lib/api/route-handler";
import { requireCanvasAccess } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";
import { payloadTooLarge } from "@/lib/uploads/body-limit";
import { directUploadsEnabled } from "@/lib/uploads/direct-upload-config";
import {
  DIRECT_UPLOAD_MIME_TYPES,
  DIRECT_UPLOAD_URL_TTL_SECONDS,
  directUploadLimit,
  directUploadStagingKey,
  directUploadStorageKey,
  presignDirectUpload,
  requireDirectUploadStorage,
  reserveDirectUpload,
} from "@/lib/uploads/direct-upload";
import { failUploadReservation } from "@/lib/uploads/lifecycle";

const requestSchema = z
  .object({
    canvasId: z
      .string()
      .regex(/^c[a-z0-9]{20,}$/i, "A valid canvasId is required"),
    filename: z.string().trim().min(1).max(255),
    contentType: z.enum(DIRECT_UPLOAD_MIME_TYPES),
    size: z.number().int().positive(),
  })
  .strict();

export const POST = withAuthValidation(
  requestSchema,
  async (data, _request, session) => {
    if (!directUploadsEnabled()) {
      throw new ApiError(
        409,
        "https://memoria.local/errors/direct-upload-unavailable",
        "Direct upload unavailable",
        "This server takes uploads through /api/v1/upload.",
      );
    }
    const userId = session.user.id;

    const limit = directUploadLimit(data.contentType);
    if (data.size > limit) throw payloadTooLarge(limit);

    await requireCanvasAccess(
      data.canvasId,
      userId,
      session.user.email ?? "",
      "EDIT",
    );

    // Storage settings are checked before the quota is charged.
    const { bucket } = requireDirectUploadStorage();

    const asset = await reserveDirectUpload(prisma, {
      userId,
      canvasId: data.canvasId,
      storageKey: directUploadStorageKey(
        userId,
        data.filename,
        data.contentType,
      ),
      filename: data.filename,
      mimeType: data.contentType,
      size: data.size,
      maxFiles: LAUNCH_LIMITS.uploadsPerUser,
      maxBytes: LAUNCH_LIMITS.uploadBytesPerUser,
    });

    let uploadUrl: string;
    try {
      uploadUrl = await presignDirectUpload({
        bucket,
        stagingKey: directUploadStagingKey(asset.storageKey),
        contentType: data.contentType,
        size: data.size,
      });
    } catch (error) {
      await failUploadReservation(prisma, asset.id, "presign_failed");
      throw error;
    }

    return NextResponse.json(
      {
        assetId: asset.id,
        uploadUrl,
        method: "PUT",
        headers: { "Content-Type": data.contentType },
        expiresAt: new Date(
          Date.now() + DIRECT_UPLOAD_URL_TTL_SECONDS * 1000,
        ).toISOString(),
        maxBytes: limit,
      },
      { status: 201 },
    );
  },
);
