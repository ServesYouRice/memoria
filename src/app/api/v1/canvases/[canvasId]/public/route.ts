/**
 * Public Canvas Sharing API
 * POST /api/v1/canvases/[canvasId]/public - Make canvas public and generate share link
 * DELETE /api/v1/canvases/[canvasId]/public - Make canvas private
 */

import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api/auth";
import { errorResponse } from "@/lib/errors";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import { withApiHandler } from "@/lib/api/route-handler";
import {
  disablePublicCanvas,
  enablePublicCanvas,
  rotatePublicCanvasLink,
} from "@/lib/sharing/public-links";

interface RouteContext {
  params: Promise<{ canvasId: string }>;
}

/**
 * POST - Make canvas public and generate share link
 */
export const POST = withApiHandler(
  async (request: NextRequest, { params }: RouteContext) => {
    try {
      const { userId } = await requireAuth();
      const { canvasId } = await params;

      const updatedCanvas = await enablePublicCanvas(prisma, canvasId, userId);

      await invalidateCanvasCache(canvasId);

      // Generate share URL
      const shareBaseUrl =
        process.env.AUTH_URL ||
        process.env.NEXTAUTH_URL ||
        request.nextUrl.origin;
      const shareUrl = `${shareBaseUrl}/share/${updatedCanvas.shareToken}`;

      return NextResponse.json({
        shareToken: updatedCanvas.shareToken,
        shareUrl,
        isPublic: updatedCanvas.isPublic,
      });
    } catch (error) {
      return errorResponse(error, request.url);
    }
  },
);

/**
 * DELETE - Make canvas private
 */
export const DELETE = withApiHandler(
  async (request: NextRequest, { params }: RouteContext) => {
    try {
      const { userId } = await requireAuth();
      const { canvasId } = await params;

      const updatedCanvas = await disablePublicCanvas(prisma, canvasId, userId);

      await invalidateCanvasCache(canvasId);

      return NextResponse.json({
        isPublic: updatedCanvas.isPublic,
        message: "Canvas is now private",
      });
    } catch (error) {
      return errorResponse(error, request.url);
    }
  },
);

/** PUT - Rotate the URL while keeping public sharing enabled. */
export const PUT = withApiHandler(
  async (request: NextRequest, { params }: RouteContext) => {
    try {
      const { userId } = await requireAuth();
      const { canvasId } = await params;
      const updatedCanvas = await rotatePublicCanvasLink(
        prisma,
        canvasId,
        userId,
      );
      await invalidateCanvasCache(canvasId);
      const shareBaseUrl =
        process.env.AUTH_URL ||
        process.env.NEXTAUTH_URL ||
        request.nextUrl.origin;
      return NextResponse.json({
        shareToken: updatedCanvas.shareToken,
        shareUrl: `${shareBaseUrl}/share/${updatedCanvas.shareToken}`,
        isPublic: updatedCanvas.isPublic,
      });
    } catch (error) {
      return errorResponse(error, request.url);
    }
  },
);
