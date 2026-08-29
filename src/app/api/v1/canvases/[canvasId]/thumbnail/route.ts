import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, requireCanvasAccess } from "@/lib/api/auth";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  errorResponse,
} from "@/lib/errors";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";
import { readPrivateUploadObject } from "@/lib/uploads/private-storage";
import { z } from "zod";

interface RouteContext {
  params: Promise<{ canvasId: string }>;
}
const MAX_THUMBNAIL_BYTES = 200 * 1024;
const DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const thumbnailBodySchema = z
  .object({
    thumbnail: z.string().max(300_000),
    expectedRevision: z.string().regex(/^\d+$/),
  })
  .strict();

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId, email } = await requireAuth();
    const { canvasId } = await params;
    await requireCanvasAccess(canvasId, userId, email, "VIEW");
    const canvas = await prisma.canvas.findUnique({
      where: { id: canvasId },
      select: { thumbnailKey: true },
    });
    if (!canvas?.thumbnailKey) throw new NotFoundError("Thumbnail not found");
    const object = await readPrivateUploadObject(
      process.env.UPLOAD_STORAGE || "local",
      canvas.thumbnailKey,
    );
    return new NextResponse(object.body, {
      headers: {
        "Content-Type": object.contentType || "application/octet-stream",
        "Cache-Control": "private, max-age=86400",
        ETag: object.etag,
        ...(object.contentLength
          ? { "Content-Length": String(object.contentLength) }
          : {}),
      },
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = await requireAuth();
    const { canvasId } = await params;
    const canvas = await prisma.canvas.findUnique({
      where: { id: canvasId },
      select: { userId: true },
    });
    if (!canvas) throw new NotFoundError("Canvas not found");
    if (canvas.userId !== userId)
      throw new ForbiddenError("Only the owner can update thumbnails");
    const body = thumbnailBodySchema.parse(await request.json());
    const match =
      typeof body.thumbnail === "string" ? DATA_URL.exec(body.thumbnail) : null;
    if (!match?.[1] || !match[2])
      throw new ValidationError("Invalid thumbnail data");
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length === 0 || bytes.length > MAX_THUMBNAIL_BYTES) {
      throw new ValidationError("Thumbnail must not exceed 200 KB");
    }
    const expectedRevision = BigInt(body.expectedRevision);
    const result = await prisma.$transaction(async (tx) => {
      const revisionRows = await tx.$queryRaw<Array<{ revision: bigint }>>`
        SELECT COALESCE(MAX("sequence"), 0) AS revision FROM "CanvasEvent" WHERE "canvasId" = ${canvasId}
      `;
      const revision = revisionRows[0]?.revision ?? 0n;
      if (revision !== expectedRevision) {
        return { queued: false as const, revision };
      }
      const installed = await tx.canvas.findUnique({
        where: { id: canvasId },
        select: { thumbnailRevision: true, thumbnailKey: true },
      });
      if (installed?.thumbnailKey && installed.thumbnailRevision === revision) {
        return { queued: false as const, revision };
      }
      const candidate = await tx.canvasThumbnailCandidate.upsert({
        where: { canvasId_revision: { canvasId, revision } },
        create: { canvasId, revision, mimeType: `image/${match[1]}`, bytes },
        update: { mimeType: `image/${match[1]}`, bytes, createdAt: new Date() },
      });
      await enqueueOutboxJob(tx, {
        type: "thumbnail.store",
        payload: { candidateId: candidate.id },
        dedupeKey: `thumbnail.store:${canvasId}:${revision}`,
      });
      return { queued: true as const, revision };
    });
    return NextResponse.json(
      {
        queued: result.queued,
        stale: !result.queued && result.revision !== expectedRevision,
        revision: result.revision.toString(),
      },
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error, request.url);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = await requireAuth();
    const { canvasId } = await params;
    await prisma.$transaction(async (tx) => {
      const canvas = await tx.canvas.findUnique({
        where: { id: canvasId },
        select: { userId: true, thumbnailKey: true },
      });
      if (!canvas) throw new NotFoundError("Canvas not found");
      if (canvas.userId !== userId)
        throw new ForbiddenError("Only the owner can delete thumbnails");
      await tx.canvas.update({
        where: { id: canvasId },
        data: { thumbnailKey: null, thumbnailRevision: 0 },
      });
      await tx.canvasThumbnailCandidate.deleteMany({ where: { canvasId } });
      if (canvas.thumbnailKey) {
        await enqueueOutboxJob(tx, {
          type: "thumbnail.delete",
          payload: { storageKey: canvas.thumbnailKey },
          dedupeKey: `thumbnail.delete:${canvas.thumbnailKey}`,
        });
      }
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
