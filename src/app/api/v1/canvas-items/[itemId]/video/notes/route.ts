import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuthValidation } from "@/lib/api/route-handler";
import { requireItemAccess } from "@/lib/api/auth";
import { NotFoundError, UnprocessableEntityError } from "@/lib/errors";
import { videoUrlAt } from "@/lib/video/video-link";
import {
  VIDEO_BUDGET,
  addVideoNote,
  videoNoteSchema,
  videoOfItem,
} from "@/lib/video/video-items";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

/**
 * POST /api/v1/canvas-items/{itemId}/video/notes (IMP-114): "Add note at a
 * time". The note keeps the video (its item) and the moment (`seconds`).
 * People who may edit the canvas may add notes.
 */
export const POST = withAuthValidation(
  videoNoteSchema,
  async (data, _request, session, context) => {
    const { itemId } = await (context as RouteContext).params;
    await requireItemAccess(
      itemId,
      session.user.id,
      session.user.email ?? "",
      "EDIT",
    );
    const item = await prisma.canvasItem.findFirst({
      where: { id: itemId, deletedAt: null, canvas: { deletedAt: null } },
      select: { type: true, content: true },
    });
    const target = item ? videoOfItem(item) : null;
    if (!target) throw new NotFoundError("Video not found");

    const note = await prisma.$transaction((tx) =>
      addVideoNote(tx, {
        itemId,
        authorId: session.user.id,
        seconds: data.seconds,
        text: data.text,
      }),
    );
    if (!note) {
      throw new UnprocessableEntityError(
        `A video can have at most ${VIDEO_BUDGET.maxNotesPerVideo} notes.`,
      );
    }
    return NextResponse.json(
      {
        id: note.id,
        seconds: note.seconds,
        text: note.text,
        openUrl: videoUrlAt(target.video, note.seconds),
        mine: true,
        createdAt: note.createdAt.toISOString(),
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  },
);
