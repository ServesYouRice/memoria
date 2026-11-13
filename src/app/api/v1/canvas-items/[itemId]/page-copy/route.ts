import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/route-handler";
import { requireItemAccess } from "@/lib/api/auth";
import { NotFoundError } from "@/lib/errors";
import { ItemType } from "@/types/canvas";
import { enqueueOutboxJobs } from "@/lib/outbox/enqueue";
import {
  PAGE_COPY_JOB,
  pageCopyDedupeKey,
  wantsArchiveLookup,
} from "@/lib/services/page-copy";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

/**
 * GET /api/v1/canvas-items/{itemId}/page-copy (IMP-094): the saved readable
 * text of a link's page and when it was read, plus any web-archive link.
 * Anyone who may view the canvas may read it. The text is untrusted web
 * content and is returned as plain text for display as plain text.
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
      select: { type: true, content: true, pageCopy: true },
    });
    if (!item || item.type !== ItemType.BOOKMARK) {
      throw new NotFoundError("Saved link not found");
    }
    const url = (item.content as { url?: unknown } | null)?.url;
    // A copy of an address the link no longer points to is not offered.
    const copy =
      item.pageCopy && item.pageCopy.url === url ? item.pageCopy : null;

    // Links saved before the owner turned the archive lookup on are looked
    // up the first time the owner opens their copy.
    let archivePending = false;
    if (
      access === "OWNER" &&
      !copy?.archiveCheckedAt &&
      (await wantsArchiveLookup(prisma, session.user.id))
    ) {
      await enqueueOutboxJobs(prisma, [
        {
          type: PAGE_COPY_JOB,
          payload: { itemId },
          dedupeKey: `${pageCopyDedupeKey(itemId)}:archive`,
        },
      ]);
      archivePending = true;
    }

    return NextResponse.json(
      {
        url: typeof url === "string" ? url : null,
        copy: copy
          ? {
              text: copy.text || null,
              readAt: copy.readAt?.toISOString() ?? null,
              archiveUrl: copy.archiveUrl,
            }
          : null,
        archivePending,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  },
);
