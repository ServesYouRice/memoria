import { type NextRequest, NextResponse } from "next/server";
import { ItemType, Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAuth } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import {
  ConflictError,
  NotFoundError,
  ForbiddenError,
  ValidationError,
  errorResponse,
} from "@/lib/errors";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import { parseCanvasItemContent } from "@/lib/validation/canvas-item";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";

interface RouteContext {
  params: Promise<{ canvasId: string; versionId: string }>;
}

const snapshotItemSchema = z
  .object({
    id: z.string().cuid(),
    type: z.nativeEnum(ItemType),
    positionX: z.number().finite(),
    positionY: z.number().finite(),
    width: z.number().positive().finite(),
    height: z.number().positive().finite(),
    zIndex: z.number().int(),
    content: z.unknown(),
    tags: z.array(z.string()).max(20).default([]),
  })
  .strict()
  .passthrough();

const snapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().min(1).max(255).optional(),
    zoomLevel: z.number().min(0.1).max(5).optional(),
    panX: z.number().finite().optional(),
    panY: z.number().finite().optional(),
    items: z.array(snapshotItemSchema).max(LAUNCH_LIMITS.itemsPerCanvas),
  })
  .passthrough();

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = await requireAuth();
    const { canvasId, versionId } = await params;
    const version = await prisma.canvasVersion.findFirst({
      where: { id: versionId, canvasId, canvas: { userId } },
      select: { id: true, name: true, createdAt: true, snapshot: true },
    });
    if (!version) throw new NotFoundError("Version not found");
    return NextResponse.json(version);
  } catch (error) {
    return errorResponse(error, request.url);
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = await requireAuth();
    const { canvasId, versionId } = await params;
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '10000ms'");
        await lockCanvasForMutation(tx, canvasId);
        const [canvas, version] = await Promise.all([
          tx.canvas.findUnique({
            where: { id: canvasId },
            select: { userId: true, name: true },
          }),
          tx.canvasVersion.findFirst({ where: { id: versionId, canvasId } }),
        ]);
        if (!canvas) throw new NotFoundError("Canvas not found");
        if (canvas.userId !== userId)
          throw new ForbiddenError("You can only restore your own canvases");
        if (!version) throw new NotFoundError("Version not found");
        const serialized = JSON.stringify(version.snapshot);
        if (
          Buffer.byteLength(serialized, "utf8") >
          LAUNCH_LIMITS.versionSnapshotBytes
        ) {
          throw new ValidationError(
            "Version exceeds the supported restore byte limit",
          );
        }
        const snapshot = snapshotSchema.parse(version.snapshot);
        const seen = new Set<string>();
        const rows = snapshot.items.map((item) => {
          if (seen.has(item.id))
            throw new ValidationError("Version contains duplicate item IDs");
          seen.add(item.id);
          return {
            ...item,
            content: parseCanvasItemContent(item.type, item.content),
          };
        });
        const ids = rows.map((item) => item.id);
        const collisions = ids.length
          ? await tx.canvasItem.count({
              where: { id: { in: ids }, canvasId: { not: canvasId } },
            })
          : 0;
        if (collisions)
          throw new ConflictError(
            "Version item identity conflicts with another canvas",
          );
        const rowsJson = JSON.stringify(rows);

        await tx.$executeRaw`
        WITH input AS (
          SELECT * FROM jsonb_to_recordset(${rowsJson}::jsonb) AS value(
            "id" text, "type" text, "positionX" double precision,
            "positionY" double precision, "width" double precision,
            "height" double precision, "zIndex" integer, "content" jsonb, "tags" jsonb
          )
        )
        UPDATE "CanvasItem" item SET
          "type" = input."type"::"ItemType", "positionX" = input."positionX",
          "positionY" = input."positionY", "width" = input."width", "height" = input."height",
          "zIndex" = input."zIndex", "content" = input."content",
          "tags" = ARRAY(SELECT jsonb_array_elements_text(input."tags")),
          "deletedAt" = NULL, "deletedById" = NULL, "updatedById" = ${userId},
          "version" = item."version" + 1, "updatedAt" = NOW()
        FROM input WHERE item."id" = input."id" AND item."canvasId" = ${canvasId}
      `;
        await tx.$executeRaw`
        WITH input AS (
          SELECT * FROM jsonb_to_recordset(${rowsJson}::jsonb) AS value(
            "id" text, "type" text, "positionX" double precision,
            "positionY" double precision, "width" double precision,
            "height" double precision, "zIndex" integer, "content" jsonb, "tags" jsonb
          )
        )
        INSERT INTO "CanvasItem" (
          "id", "canvasId", "type", "positionX", "positionY", "width", "height",
          "zIndex", "content", "tags", "version", "createdById", "updatedById", "createdAt", "updatedAt"
        )
        SELECT input."id", ${canvasId}, input."type"::"ItemType", input."positionX",
          input."positionY", input."width", input."height", input."zIndex", input."content",
          ARRAY(SELECT jsonb_array_elements_text(input."tags")), 1, ${userId}, ${userId}, NOW(), NOW()
        FROM input WHERE NOT EXISTS (SELECT 1 FROM "CanvasItem" existing WHERE existing."id" = input."id")
      `;
        await tx.canvasItem.updateMany({
          where: {
            canvasId,
            ...(ids.length ? { id: { notIn: ids } } : {}),
            deletedAt: null,
          },
          data: {
            deletedAt: new Date(),
            deletedById: userId,
            updatedById: userId,
            version: { increment: 1 },
          },
        });
        const restoredCanvas = await tx.canvas.update({
          where: { id: canvasId },
          data: {
            name: snapshot.name ?? canvas.name,
            zoomLevel: snapshot.zoomLevel ?? 1,
            panX: snapshot.panX ?? 0,
            panY: snapshot.panY ?? 0,
            restoreRevision: { increment: 1 },
          },
          select: { restoreRevision: true },
        });
        const versionCount = await tx.canvasVersion.count({
          where: { canvasId },
        });
        if (versionCount >= LAUNCH_LIMITS.versionsPerCanvas) {
          const oldest = await tx.canvasVersion.findMany({
            where: { canvasId, id: { not: versionId } },
            orderBy: { createdAt: "asc" },
            take: versionCount - LAUNCH_LIMITS.versionsPerCanvas + 1,
            select: { id: true },
          });
          await tx.canvasVersion.deleteMany({
            where: { id: { in: oldest.map((entry) => entry.id) } },
          });
        }
        await tx.canvasVersion.create({
          // A stored snapshot is never SQL NULL in practice, but the read type
          // admits null; map it explicitly rather than widening the write type.
          data: {
            canvasId,
            name: `Restored ${version.name}`,
            snapshot: version.snapshot ?? Prisma.JsonNull,
          },
        });
        const event = await tx.canvasEvent.create({
          data: {
            canvasId,
            actorId: userId,
            entityId: canvasId,
            entityVersion: restoredCanvas.restoreRevision,
            operation: "restored",
          },
        });
        await enqueueOutboxJob(tx, {
          type: "canvas.restore.publish",
          payload: { eventId: event.id },
          dedupeKey: `canvas.restore.publish:${event.id}`,
        });
        return restoredCanvas;
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
    await invalidateCanvasCache(canvasId);
    return NextResponse.json({
      success: true,
      restoreRevision: result.restoreRevision,
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
