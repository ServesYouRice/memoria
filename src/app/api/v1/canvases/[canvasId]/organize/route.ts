import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import {
  getOrganizerProfileForCanvas,
  listLooseItems,
  proposeCanvasPiles,
  suggestPilesForOwner,
} from "@/lib/agents/piles";
import { SORT_INSTRUCTION_MAX_LENGTH } from "@/lib/ai/sort-piles";
import { getLatestClipBatchNote } from "@/lib/services/clip-batch";
import { AGENT_CAPABILITY_RUNGS } from "@/lib/agents/constants";
import { assertAgentCapability } from "@/lib/agents/policy";

interface RouteContext {
  params: Promise<{ canvasId: string }>;
}

const organizeSchema = z.object({
  maxPiles: z.number().int().min(1).max(12).default(8),
  /**
   * What the owner wants ("by project; travel together"). Omitted means the
   * latest batch note on this board; an empty string means none.
   */
  instruction: z
    .string()
    .trim()
    .max(SORT_INSTRUCTION_MAX_LENGTH)
    .nullable()
    .optional(),
});

/**
 * "Sort into piles": groups the board's loose items and files the result as
 * a suggestion from the built-in organizer. With AI configured the piles
 * follow the owner's instruction; otherwise words decide. Nothing moves until
 * the owner approves it, and the applied sort can be undone in one step.
 */
export const POST = withApiHandler(
  async (request: Request, { params }: RouteContext) => {
    const { userId } = await requireAuth();
    const { canvasId } = await params;
    const body = organizeSchema.parse(await request.json().catch(() => ({})));

    const canvas = await prisma.canvas.findFirst({
      where: { id: canvasId, userId },
      select: { id: true },
    });
    if (!canvas) {
      throw new NotFoundError("Canvas not found.");
    }

    const instruction =
      body.instruction === undefined
        ? ((await getLatestClipBatchNote(canvasId, { userId }))?.note
            ?.trim()
            .slice(0, SORT_INSTRUCTION_MAX_LENGTH) ?? null)
        : body.instruction || null;
    // Check the organizer before any AI call so a disabled one costs nothing.
    const organizer = await getOrganizerProfileForCanvas(userId, canvasId);
    assertAgentCapability(organizer, AGENT_CAPABILITY_RUNGS.PROPOSE);
    const sorted = await suggestPilesForOwner({
      userId,
      items: await listLooseItems(canvasId),
      instruction,
      maxPiles: body.maxPiles,
    });
    const { piles } = sorted;
    const meta = {
      method: sorted.method,
      notice: sorted.notice,
      instruction,
    };
    if (piles.length === 0) {
      return NextResponse.json({ suggestionId: null, piles: [], ...meta });
    }

    const { suggestion } = await proposeCanvasPiles({
      actor: {
        userId,
        agentProfileId: organizer.id,
        modelCredentialId: organizer.defaultModelCredentialId,
      },
      canvasId,
      piles,
    });

    return NextResponse.json(
      {
        suggestionId: suggestion.id,
        summary: suggestion.summary,
        piles: piles.map((pile) => ({
          title: pile.title,
          itemCount: pile.itemIds.length,
        })),
        ...meta,
      },
      { status: 201 },
    );
  },
);
