import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { archiveRecapStaleLinks } from "@/lib/recap/archive-stale";

interface RouteContext {
  params: Promise<{ recapId: string }>;
}

const paramsSchema = z.object({ recapId: z.string().min(1).max(64) });

/**
 * IMP-070 "Archive these": the recap's stale links go to the trash-backed
 * archive in one change set. Undo goes through the change-set revert.
 */
export const POST = withApiHandler(
  async (_request: Request, { params }: RouteContext) => {
    const { userId } = await requireAuth();
    const { recapId } = paramsSchema.parse(await params);
    const result = await archiveRecapStaleLinks({ userId, recapId });
    return NextResponse.json({
      changeSetId: result.changeSetId,
      archivedItemCount: result.archivedItemCount,
    });
  },
);
