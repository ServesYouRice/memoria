import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCanvasAccess, requireCanvasAccess } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { prisma } from "@/lib/db";
import { notFoundError, unauthorizedError } from "@/lib/errors";
import { readPrivateUploadObject } from "@/lib/uploads/private-storage";
import { enqueueUploadDeletion } from "@/lib/uploads/lifecycle";

interface RouteContext {
  params: Promise<{ assetId: string }>;
}

async function findAsset(assetId: string) {
  const asset = await prisma.uploadAsset.findUnique({
    where: { id: assetId },
    include: {
      canvas: { select: { isPublic: true } },
    },
  });
  if (!asset) throw notFoundError("Upload", assetId);
  return asset;
}

export const GET = withApiHandler(
  async (request: NextRequest, { params }: RouteContext) => {
    const { assetId } = await params;
    const asset = await findAsset(assetId);
    if (asset.status !== "ACTIVE") throw notFoundError("Upload", assetId);

    if (!asset.canvas.isPublic) {
      const session = await auth();
      if (!session?.user?.id || !session.user.email) {
        throw unauthorizedError();
      }
      const access = await getCanvasAccess(
        asset.canvasId,
        session.user.id,
        session.user.email,
      );
      if (access === "NONE") throw notFoundError("Upload", assetId);
    }

    const object = await readPrivateUploadObject(
      asset.storageMode,
      asset.storageKey,
    ).catch(() => {
      throw notFoundError("Upload", assetId);
    });
    // Public canvas assets are cacheable for a short window (300s) with
    // ETag validation. This bounds Node and object storage round trips on
    // popular public links while keeping the link-revocation and asset-deletion
    // window to at most 5 minutes. Private canvas assets remain non-cacheable.
    const cacheControl = asset.canvas.isPublic
      ? "public, max-age=300, must-revalidate"
      : "private, max-age=0, must-revalidate";

    const headers: Record<string, string> = {
      "content-type": asset.mimeType,
      "cache-control": cacheControl,
      etag: object.etag,
      "x-content-type-options": "nosniff",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,
    };
    if (object.contentLength !== undefined) {
      headers["content-length"] = String(object.contentLength);
    }
    if (request.headers.get("if-none-match") === object.etag) {
      await object.body.cancel();
      return new NextResponse(null, { status: 304, headers });
    }

    return new NextResponse(object.body, {
      headers: {
        ...headers,
      },
    });
  },
);

export const DELETE = withApiHandler(
  async (_request: NextRequest, { params }: RouteContext) => {
    const session = await auth();
    if (!session?.user?.id || !session.user.email) throw unauthorizedError();
    const { assetId } = await params;
    const asset = await findAsset(assetId);
    await requireCanvasAccess(
      asset.canvasId,
      session.user.id,
      session.user.email,
      "OWNER",
    );

    await prisma.$transaction((tx) => enqueueUploadDeletion(tx, asset.id));
    return NextResponse.json(
      { success: true, status: "deleting" },
      { status: 202 },
    );
  },
);
