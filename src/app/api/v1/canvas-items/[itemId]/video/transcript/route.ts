import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth, withAuthValidation } from "@/lib/api/route-handler";
import { requireItemAccess } from "@/lib/api/auth";
import {
  NotFoundError,
  UnprocessableEntityError,
  ValidationError,
} from "@/lib/errors";
import {
  VIDEO_BUDGET,
  recordNoTranscript,
  storeTranscript,
  transcriptSchema,
  videoOfItem,
} from "@/lib/video/video-items";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

async function loadVideo(itemId: string) {
  const item = await prisma.canvasItem.findFirst({
    where: { id: itemId, deletedAt: null, canvas: { deletedAt: null } },
    select: { type: true, content: true, canvas: { select: { userId: true } } },
  });
  const target = item ? videoOfItem(item) : null;
  if (!item || !target) throw new NotFoundError("Video not found");
  return { target, ownerId: item.canvas.userId };
}

/**
 * PUT /api/v1/canvas-items/{itemId}/video/transcript (IMP-114): paste a
 * transcript onto a video card. Works whether or not automatic fetching is
 * on, and replaces a fetched one. People who may edit the canvas may paste;
 * the text counts against the canvas owner's transcript budget.
 */
export const PUT = withAuthValidation(
  transcriptSchema,
  async (data, _request, session, context) => {
    const { itemId } = await (context as RouteContext).params;
    await requireItemAccess(
      itemId,
      session.user.id,
      session.user.email ?? "",
      "EDIT",
    );
    const { target, ownerId } = await loadVideo(itemId);
    const result = await prisma.$transaction((tx) =>
      storeTranscript(tx, {
        itemId,
        userId: ownerId,
        url: target.url,
        text: data.text,
        source: "PASTED",
      }),
    );
    if (result === "empty") {
      throw new ValidationError("Paste the transcript's text.", [
        { field: "text", message: "Paste the transcript's text." },
      ]);
    }
    if (result === "too-large") {
      throw new ValidationError(
        `A transcript can be at most ${VIDEO_BUDGET.maxBytesPerVideo / 1024} KB.`,
        [{ field: "text", message: "The transcript is too long." }],
      );
    }
    if (result === "over-budget") {
      throw new UnprocessableEntityError(
        "There is no room left for more transcripts on this account.",
      );
    }
    return NextResponse.json(
      { stored: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
);

/**
 * DELETE /api/v1/canvas-items/{itemId}/video/transcript: clear a video's
 * transcript. It stays cleared: automatic fetching does not read it again.
 */
export const DELETE = withAuth<unknown, RouteContext>(
  async (_request, session, { params }) => {
    const { itemId } = await params;
    await requireItemAccess(
      itemId,
      session.user.id,
      session.user.email ?? "",
      "EDIT",
    );
    const { target, ownerId } = await loadVideo(itemId);
    await recordNoTranscript(prisma, {
      itemId,
      userId: ownerId,
      url: target.url,
      source: "PASTED",
    });
    return new NextResponse(null, { status: 204 });
  },
);
