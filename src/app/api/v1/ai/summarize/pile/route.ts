/**
 * POST /api/v1/ai/summarize/pile
 * IMP-069: turn a pile (frame) into a new note next to it — a summary, a
 * checklist or a comparison table. Needs EDIT access to the canvas; the
 * pile's own items are never changed.
 */
import { NextResponse } from "next/server";
import { withAuthValidation } from "@/lib/api/route-handler";
import {
  pileTransformSchema,
  transformPileIntoNote,
} from "@/lib/ai/pile-transform";

export const POST = withAuthValidation(
  pileTransformSchema,
  async ({ canvasId, frameId, kind }, _req, session) => {
    const result = await transformPileIntoNote({
      canvasId,
      frameId,
      kind,
      userId: session.user.id,
      email: session.user.email ?? "",
    });
    return NextResponse.json(result, { status: 201 });
  },
);
