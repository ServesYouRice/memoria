/**
 * Direct upload confirm (IMP-152).
 *
 * POST `{ assetId }` after the browser PUT the file to its signed URL. The
 * stored object is checked before the asset is saved:
 * - missing: 409, the reservation stays so the client may retry while its
 *   URL is valid (the expiry job releases it otherwise);
 * - another size than reserved, or above the cap: 413;
 * - another type than reserved, or content that is not that type, an image
 *   out of bounds, or a failed malware scan: 400/422.
 * A rejected object fails the reservation (quota released) and is deleted.
 * An accepted one is written to the asset's own key and activated; the
 * response matches `/api/v1/upload`. Confirming twice returns the same
 * asset.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { UploadAssetStatus } from "@/generated/prisma/client";
import { withAuthValidation } from "@/lib/api/route-handler";
import { requireCanvasAccess } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import {
  ApiError,
  ConflictError,
  UnprocessableEntityError,
  notFoundError,
} from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { payloadTooLarge } from "@/lib/uploads/body-limit";
import {
  directUploadLimit,
  directUploadStagingKey,
  isDirectUploadType,
} from "@/lib/uploads/direct-upload";
import { detectUploadType } from "@/lib/uploads/file-types";
import { checkImageBounds } from "@/lib/uploads/image-bounds";
import {
  UploadNotPendingError,
  activateUploadAsset,
  compensateWrittenUpload,
  failUploadReservation,
} from "@/lib/uploads/lifecycle";
import { runMalwareScan } from "@/lib/uploads/malware-scan";
import {
  deletePrivateUploadObject,
  headPrivateUploadObject,
  readPrivateUploadObject,
  writePrivateUploadObject,
} from "@/lib/uploads/private-storage";

const logger = createLogger("upload/direct");

const requestSchema = z.object({ assetId: z.string().cuid() }).strict();

type Asset = {
  id: string;
  userId: string;
  canvasId: string;
  storageKey: string;
  storageMode: string;
  filename: string;
  mimeType: string;
  size: number;
};

function uploadResponse(asset: Asset) {
  return NextResponse.json({
    assetId: asset.id,
    url: `/api/v1/uploads/${asset.id}`,
    filename: asset.filename,
    size: asset.size,
    type: asset.mimeType,
    storage: "s3",
  });
}

function badUpload(detail: string) {
  return new ApiError(
    400,
    "https://memoria.local/errors/upload",
    "Bad Request",
    detail,
  );
}

/** Read the whole object, refusing more than `maxBytes`. */
async function readObject(storageKey: string, maxBytes: number) {
  const object = await readPrivateUploadObject("s3", storageKey);
  const reader = object.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw payloadTooLarge(maxBytes);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Checks of the stored object; throws the error the client sees. */
async function checkStagedObject(asset: Asset, stagingKey: string) {
  const head = await headPrivateUploadObject(stagingKey);
  if (!head) {
    return { missing: true as const };
  }
  const limit = directUploadLimit(asset.mimeType);
  if (asset.size > limit || (head.contentLength ?? 0) > limit) {
    throw payloadTooLarge(limit);
  }
  if (head.contentLength !== asset.size) {
    throw badUpload("File size does not match the upload request");
  }
  const storedType = head.contentType?.split(";")[0]?.trim().toLowerCase();
  if (storedType !== asset.mimeType) {
    throw badUpload("File type does not match the upload request");
  }

  const buffer = await readObject(stagingKey, asset.size);
  if (buffer.length !== asset.size) {
    throw payloadTooLarge(asset.size);
  }
  const detected = detectUploadType(buffer);
  if (!detected || detected.mime !== asset.mimeType) {
    throw badUpload("File type does not match content");
  }
  if (detected.kind === "image") {
    const bounds = checkImageBounds(buffer, detected.mime);
    if (!bounds.ok) throw new UnprocessableEntityError(bounds.reason);
  }
  await runMalwareScan(buffer, asset.filename, detected.mime);
  return { missing: false as const, buffer };
}

export const POST = withAuthValidation(
  requestSchema,
  async (data, _request, session) => {
    const userId = session.user.id;
    const asset = await prisma.uploadAsset.findUnique({
      where: { id: data.assetId },
    });
    // Only the uploader confirms, and only a direct (S3) reservation.
    if (
      !asset ||
      asset.userId !== userId ||
      asset.storageMode !== "s3" ||
      !isDirectUploadType(asset.mimeType)
    ) {
      throw notFoundError("Upload", data.assetId);
    }
    if (asset.status === UploadAssetStatus.ACTIVE) return uploadResponse(asset);
    if (asset.status !== UploadAssetStatus.PENDING) {
      throw new ConflictError("This upload has expired or was removed.");
    }

    await requireCanvasAccess(
      asset.canvasId,
      userId,
      session.user.email ?? "",
      "EDIT",
    );

    const stagingKey = directUploadStagingKey(asset.storageKey);
    let checked: Awaited<ReturnType<typeof checkStagedObject>>;
    try {
      checked = await checkStagedObject(asset, stagingKey);
    } catch (error) {
      // A rejected file (4xx) gives its quota back and is removed; a
      // storage or scanner outage (5xx) leaves the reservation to retry.
      if (error instanceof ApiError && error.status < 500) {
        await failUploadReservation(prisma, asset.id, "direct_upload_rejected");
        await deletePrivateUploadObject("s3", stagingKey).catch(() => {
          logger.warn(
            { assetId: asset.id },
            "Rejected direct upload kept until its expiry job",
          );
        });
      }
      throw error;
    }
    if (checked.missing) {
      throw new ConflictError("The file has not reached storage yet.");
    }

    // The checked bytes become the asset's object: a later PUT to the
    // staging URL cannot change what was confirmed.
    try {
      await writePrivateUploadObject(
        "s3",
        asset.storageKey,
        checked.buffer,
        asset.mimeType,
      );
    } catch (error) {
      await failUploadReservation(prisma, asset.id, "object_write_failed");
      throw error;
    }

    try {
      await activateUploadAsset(prisma, asset.id);
    } catch (activationError) {
      // A concurrent confirm of the same upload already activated it.
      const current = await prisma.uploadAsset.findUnique({
        where: { id: asset.id },
        select: { status: true },
      });
      if (
        activationError instanceof UploadNotPendingError &&
        current?.status === UploadAssetStatus.ACTIVE
      ) {
        return uploadResponse(asset);
      }
      try {
        await compensateWrittenUpload(prisma, {
          assetId: asset.id,
          userId,
          storageMode: asset.storageMode,
          storageKey: asset.storageKey,
          size: asset.size,
          reason: "activation_failed",
        });
      } catch {
        logger.error(
          { assetId: asset.id, storageKey: asset.storageKey },
          "Direct upload activation and its cleanup both failed; object retained",
        );
      }
      if (activationError instanceof UploadNotPendingError) {
        throw new ConflictError("This upload has expired or was removed.");
      }
      throw activationError;
    }

    await deletePrivateUploadObject("s3", stagingKey).catch(() => {
      // The expiry job deletes it later.
    });
    return uploadResponse(asset);
  },
);
