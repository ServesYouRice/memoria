import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/route-handler";
import { requireItemAccess } from "@/lib/api/auth";
import { NotFoundError } from "@/lib/errors";
import { videoUrlAt } from "@/lib/video/video-link";
import {
  VIDEO_BUDGET,
  enqueueTranscriptFetch,
  transcriptFetchEnabled,
  videoOfItem,
} from "@/lib/video/video-items";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

/**
 * GET /api/v1/canvas-items/{itemId}/video (IMP-114): a video card's title
 * and source, its notes with the link that opens each moment, and its
 * transcript. Anyone who may view the canvas may read them. The transcript
 * is untrusted text, returned as plain text for display as plain text.
 *
 * When automatic fetching is on, an editor opening a video that has no
 * transcript yet queues the caption read (links saved by imports, the
 * browser extension or agents get it this way).
 */
export const GET = withAuth<unknown, RouteContext>(
  async (_request, session, { params }) => {
    const { itemId } = await params;
    const access = await requireItemAccess(
      itemId,
      session.user.id,
      session.user.email ?? "",
      "VIEW",
    );

    const item = await prisma.canvasItem.findFirst({
      where: { id: itemId, deletedAt: null },
      select: {
        type: true,
        content: true,
        canvasId: true,
        videoNotes: {
          orderBy: [{ seconds: "asc" }, { createdAt: "asc" }],
          take: VIDEO_BUDGET.maxNotesPerVideo,
          select: {
            id: true,
            seconds: true,
            text: true,
            authorId: true,
            createdAt: true,
          },
        },
        transcript: {
          select: {
            url: true,
            text: true,
            source: true,
            language: true,
            fetchedAt: true,
            updatedAt: true,
          },
        },
      },
    });
    const target = item ? videoOfItem(item) : null;
    if (!item || !target) throw new NotFoundError("Video not found");

    const canEdit = access === "OWNER" || access === "EDIT";
    // A transcript of an address the card no longer points to is not offered.
    const row = item.transcript?.url === target.url ? item.transcript : null;
    const transcript = row?.text
      ? {
          text: row.text,
          source: row.source === "FETCHED" ? "fetched" : "pasted",
          language: row.language,
          updatedAt: row.updatedAt.toISOString(),
        }
      : null;

    const autoFetch =
      transcriptFetchEnabled() && target.video.provider === "youtube";
    let pending = false;
    if (autoFetch && !row && canEdit) {
      pending = await enqueueTranscriptFetch(prisma, {
        itemId,
        type: item.type,
        content: item.content,
        canvasId: item.canvasId,
      });
    }

    return NextResponse.json(
      {
        video: {
          url: target.url,
          provider: target.video.provider,
          source: target.video.source,
          host: target.host,
          title: target.title,
        },
        notes: item.videoNotes.map((note) => ({
          id: note.id,
          seconds: note.seconds,
          text: note.text,
          openUrl: videoUrlAt(target.video, note.seconds),
          mine: note.authorId === session.user.id,
          createdAt: note.createdAt.toISOString(),
        })),
        transcript,
        canEdit,
        autoFetch: { enabled: autoFetch, pending },
        limits: {
          maxNoteChars: VIDEO_BUDGET.maxNoteChars,
          maxTranscriptBytes: VIDEO_BUDGET.maxBytesPerVideo,
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  },
);
