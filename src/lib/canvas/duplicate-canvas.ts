import {
  ItemType,
  UploadAssetStatus,
  type Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import { readCurrentCanvasDocument } from "@/lib/collaboration/sync/store";
import { readAllItemStates } from "@/lib/collaboration/sync/document-items";
import { recordCanvasItemEventsBatch } from "@/lib/collaboration/committed-events";
import { UPLOAD_COPY_JOB } from "@/lib/uploads/copy-upload";
import { assertCanvasCapacity } from "@/lib/policy/capacity";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";
import { parseCanvasItemContent } from "@/lib/validation/canvas-item";
import { chargeUploadQuota } from "@/lib/uploads/lifecycle";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";
import { newItemId } from "@/lib/canvas-formats/import-canvas";
import { NotFoundError, ValidationError } from "@/lib/errors";

/**
 * "Duplicate canvas" (IMP-098). The owner gets a private copy of every live
 * item, in the same place, with attached arrows joined to the copied items.
 * Shares, comments, versions and embeds stay with the original. Each picture
 * gets its own upload in the copy, charged to the owner's storage, and an
 * outbox job copies the stored file, so the copy keeps its pictures when the
 * original is deleted.
 */

const UPLOAD_URL = /^\/api\/v1\/uploads\/(c[a-z0-9]{20,})$/i;

export function copyName(name: string) {
  return `Copy of ${name}`.slice(0, 255);
}

function uploadIdOf(url: unknown) {
  return typeof url === "string" ? (UPLOAD_URL.exec(url)?.[1] ?? null) : null;
}

/** A fresh key beside the original, keeping its extension. */
function copyStorageKey(userId: string, sourceKey: string) {
  const owner = userId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "user";
  const extension = /\.[a-z0-9]{1,8}$/i.exec(sourceKey)?.[0] ?? "";
  return `uploads/${owner}/copy-${Date.now()}-${newItemId()}${extension}`;
}

export async function duplicateCanvas(
  prisma: PrismaClient,
  input: { userId: string; canvasId: string; name?: string },
) {
  return prisma.$transaction(
    async (tx) => {
      await lockCanvasForMutation(tx, input.canvasId);
      const source = await tx.canvas.findFirst({
        where: { id: input.canvasId, userId: input.userId, isTemplate: false },
        select: {
          id: true,
          name: true,
          zoomLevel: true,
          panX: true,
          panY: true,
          workspaceId: true,
        },
      });
      if (!source) throw new NotFoundError("Canvas not found.");
      await assertCanvasCapacity(tx, input.userId);

      // The live document holds co-edited note text; rows say what is live.
      const live = await tx.canvasItem.findMany({
        where: { canvasId: source.id, deletedAt: null },
        select: { id: true },
      });
      if (live.length > LAUNCH_LIMITS.itemsPerCanvas)
        throw new ValidationError(
          `This canvas has more than ${LAUNCH_LIMITS.itemsPerCanvas} items and cannot be copied.`,
        );
      const liveIds = new Set(live.map((row) => row.id));
      const document = await readCurrentCanvasDocument(tx, source.id);
      const states = readAllItemStates(document)
        .filter((state) => liveIds.has(state.id))
        .sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
      document.destroy();

      const copy = await tx.canvas.create({
        data: {
          name: input.name?.trim() || copyName(source.name),
          userId: input.userId,
          zoomLevel: source.zoomLevel,
          panX: source.panX,
          panY: source.panY,
          workspaceId: source.workspaceId,
        },
      });

      const newIds = new Map(states.map((state) => [state.id, newItemId()]));

      // Pictures uploaded to this canvas get their own upload in the copy.
      const pictureIds = new Set<string>();
      for (const state of states) {
        if (state.type !== ItemType.IMAGE) continue;
        const id = uploadIdOf((state.content as { url?: unknown })?.url);
        if (id) pictureIds.add(id);
      }
      const assets = pictureIds.size
        ? await tx.uploadAsset.findMany({
            where: {
              id: { in: [...pictureIds] },
              canvasId: source.id,
              status: UploadAssetStatus.ACTIVE,
            },
            orderBy: { id: "asc" },
          })
        : [];
      const copiedAsset = new Map<string, string>();
      for (const asset of assets) {
        await chargeUploadQuota(tx, {
          userId: input.userId,
          size: asset.size,
          maxFiles: LAUNCH_LIMITS.uploadsPerUser,
          maxBytes: LAUNCH_LIMITS.uploadBytesPerUser,
        });
        const target = await tx.uploadAsset.create({
          data: {
            userId: input.userId,
            canvasId: copy.id,
            storageKey: copyStorageKey(input.userId, asset.storageKey),
            storageMode: asset.storageMode,
            filename: asset.filename,
            mimeType: asset.mimeType,
            size: asset.size,
            status: UploadAssetStatus.PENDING,
          },
          select: { id: true },
        });
        copiedAsset.set(asset.id, target.id);
        await enqueueOutboxJob(tx, {
          type: UPLOAD_COPY_JOB,
          payload: { sourceAssetId: asset.id, targetAssetId: target.id },
          dedupeKey: `${UPLOAD_COPY_JOB}:${target.id}`,
          maxAttempts: 5,
        });
      }

      const rows: Prisma.CanvasItemCreateManyInput[] = [];
      for (const state of states) {
        let content = { ...(state.content as Record<string, unknown>) };
        if (state.type === ItemType.ARROW) {
          for (const end of ["startItemId", "endItemId"] as const) {
            const mapped =
              typeof content[end] === "string"
                ? newIds.get(content[end] as string)
                : undefined;
            if (mapped) content[end] = mapped;
            else delete content[end];
          }
        }
        if (state.type === ItemType.IMAGE) {
          const id = uploadIdOf(content.url);
          const target = id ? copiedAsset.get(id) : undefined;
          if (target)
            content = { ...content, url: `/api/v1/uploads/${target}` };
        }
        rows.push({
          id: newIds.get(state.id)!,
          canvasId: copy.id,
          type: state.type,
          positionX: state.positionX,
          positionY: state.positionY,
          width: state.width,
          height: state.height,
          zIndex: state.zIndex,
          tags: state.tags,
          content: parseCanvasItemContent(state.type, content, {
            allowEmptyNote: true,
          }) as Prisma.InputJsonValue,
          createdById: input.userId,
          updatedById: input.userId,
        });
      }
      const items = rows.length
        ? await tx.canvasItem.createManyAndReturn({
            data: rows,
            select: { id: true, version: true },
          })
        : [];
      await recordCanvasItemEventsBatch(
        tx,
        items.map((item) => ({
          canvasId: copy.id,
          actorId: input.userId,
          itemId: item.id,
          version: item.version,
          operation: "created" as const,
        })),
      );
      return {
        id: copy.id,
        name: copy.name,
        itemCount: items.length,
        pictureCount: copiedAsset.size,
      };
    },
    { maxWait: 5_000, timeout: 30_000 },
  );
}
