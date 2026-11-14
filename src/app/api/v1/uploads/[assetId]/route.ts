import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCanvasAccess, requireCanvasAccess } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { prisma } from "@/lib/db";
import { notFoundError, unauthorizedError } from "@/lib/errors";
import { readPrivateUploadObject } from "@/lib/uploads/private-storage";
import { enqueueUploadDeletion } from "@/lib/uploads/lifecycle";
import { resolveEmbedToken } from "@/lib/embeds/service";
import { EMBED_ASSET_TOKEN_PARAM } from "@/lib/embeds/assets";
import { PDF_MIME_TYPE } from "@/lib/uploads/file-types";

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

    // A live embed token grants read access to assets of exactly its own
    // canvas. Anything else (forged, revoked, expired, other canvas) falls
    // through to the normal session check, so behaviour is unchanged.
    let viaEmbed = false;
    if (!asset.canvas.isPublic) {
      const embedToken = new URL(request.url).searchParams.get(
        EMBED_ASSET_TOKEN_PARAM,
      );
      if (embedToken) {
        const embed = await resolveEmbedToken(prisma, embedToken);
        viaEmbed = embed?.canvasId === asset.canvasId;
      }
    }

    if (!asset.canvas.isPublic && !viaEmbed) {
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
    // Embed-token reads are never stored: revocation must take effect at once.
    const cacheControl = asset.canvas.isPublic
      ? "public, max-age=300, must-revalidate"
      : viaEmbed
        ? "private, no-store"
        : "private, max-age=0, must-revalidate";

    // A PDF (IMP-113) is untrusted: it opens only as its own page, in the
    // browser's viewer in a new tab, or as a download (`?download=1`). No
    // other site may load it as a resource, and it is never framed (the
    // security headers on every response refuse framing).
    const isPdf = asset.mimeType === PDF_MIME_TYPE;
    const download =
      isPdf && new URL(request.url).searchParams.get("download") === "1";
    const headers: Record<string, string> = {
      "content-type": asset.mimeType,
      "cache-control": cacheControl,
      etag: object.etag,
      "x-content-type-options": "nosniff",
      "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,
    };
    if (isPdf) headers["cross-origin-resource-policy"] = "same-origin";
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

    // An upload still being written answers 409 (ConflictError).
    const deleted = await prisma.$transaction((tx) =>
      enqueueUploadDeletion(tx, asset.id, { inProgress: "conflict" }),
    );
    return NextResponse.json(
      {
        success: true,
        status: deleted.status === "DELETED" ? "deleted" : "deleting",
      },
      { status: 202 },
    );
  },
);
