import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/route-handler";
import { requireItemAccess } from "@/lib/api/auth";
import { NotFoundError } from "@/lib/errors";
import { ItemType } from "@/types/canvas";
import { readPrivateUploadObject } from "@/lib/uploads/private-storage";

interface RouteContext {
  params: Promise<{ itemId: string; kind: string }>;
}

/**
 * GET /api/v1/canvas-items/{itemId}/page-capture/{image|pdf} (IMP-110): the
 * picture or the PDF kept of a saved link's page. Anyone who may view the
 * canvas may read it. The file is untrusted web content, so it is served
 * with its own type and no sniffing, and the picture also sandboxed.
 */
export const GET = withAuth<unknown, RouteContext>(
  async (_request, session, { params }) => {
    const { itemId, kind } = await params;
    if (kind !== "image" && kind !== "pdf") {
      throw new NotFoundError("Page capture not found");
    }
    await requireItemAccess(
      itemId,
      session.user.id,
      session.user.email ?? "",
      "VIEW",
    );

    const item = await prisma.canvasItem.findFirst({
      where: { id: itemId, deletedAt: null, canvas: { deletedAt: null } },
      select: { type: true, content: true, pageCapture: true },
    });
    const url = (item?.content as { url?: unknown } | null)?.url;
    const capture = item?.pageCapture;
    const assetId =
      kind === "image" ? capture?.imageAssetId : capture?.pdfAssetId;
    // A capture of an address the link no longer points to is not offered.
    if (
      !item ||
      item.type !== ItemType.BOOKMARK ||
      !capture ||
      capture.url !== url ||
      !assetId
    ) {
      throw new NotFoundError("Page capture not found");
    }
    const asset = await prisma.uploadAsset.findFirst({
      where: { id: assetId, status: "ACTIVE" },
      select: { storageMode: true, storageKey: true, mimeType: true },
    });
    if (!asset) throw new NotFoundError("Page capture not found");
    const object = await readPrivateUploadObject(
      asset.storageMode,
      asset.storageKey,
    ).catch(() => {
      throw new NotFoundError("Page capture not found");
    });

    const headers: Record<string, string> = {
      "content-type": asset.mimeType,
      "content-disposition": `inline; filename="page.${kind === "pdf" ? "pdf" : "jpg"}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    };
    // Chrome's PDF viewer does not open inside a sandboxed document; the PDF
    // is generated here from the page and carries no script.
    if (kind === "image") {
      headers["content-security-policy"] = "sandbox; default-src 'none'";
    }
    if (object.contentLength !== undefined) {
      headers["content-length"] = String(object.contentLength);
    }
    return new NextResponse(object.body, { headers });
  },
);
