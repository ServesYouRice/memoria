import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/route-handler";
import { requireItemAccess } from "@/lib/api/auth";
import { NotFoundError } from "@/lib/errors";

interface RouteContext {
  params: Promise<{ itemId: string; noteId: string }>;
}

/**
 * DELETE /api/v1/canvas-items/{itemId}/video/notes/{noteId} (IMP-114).
 * People who may edit the canvas may remove its video notes.
 */
export const DELETE = withAuth<unknown, RouteContext>(
  async (_request, session, { params }) => {
    const { itemId, noteId } = await params;
    await requireItemAccess(
      itemId,
      session.user.id,
      session.user.email ?? "",
      "EDIT",
    );
    const { count } = await prisma.itemVideoNote.deleteMany({
      where: { id: noteId, itemId, item: { deletedAt: null } },
    });
    if (count === 0) throw new NotFoundError("Note not found");
    return new NextResponse(null, { status: 204 });
  },
);
