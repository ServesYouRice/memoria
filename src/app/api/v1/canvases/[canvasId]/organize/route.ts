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
  suggestPiles,
} from "@/lib/agents/piles";
import { AGENT_CAPABILITY_RUNGS } from "@/lib/agents/constants";
import { assertAgentCapability } from "@/lib/agents/policy";

interface RouteContext {
  params: Promise<{ canvasId: string }>;
}

const organizeSchema = z.object({
  maxPiles: z.number().int().min(1).max(12).default(8),
});

/**
 * "Sort into piles": groups the board's loose items and files the result as
 * a suggestion from the built-in organizer. Nothing moves until the owner
 * approves it, and the applied sort can be undone in one step.
 */
export const POST = withApiHandler(
  async (request: Request, { params }: RouteContext) => {
    const { userId } = await requireAuth();
    const { canvasId } = await params;
    const { maxPiles } = organizeSchema.parse(
      await request.json().catch(() => ({})),
    );

    const canvas = await prisma.canvas.findFirst({
      where: { id: canvasId, userId },
      select: { id: true },
    });
    if (!canvas) {
      throw new NotFoundError("Canvas not found.");
    }

    const piles = suggestPiles(await listLooseItems(canvasId), { maxPiles });
    if (piles.length === 0) {
      return NextResponse.json({ suggestionId: null, piles: [] });
    }

    const organizer = await getOrganizerProfileForCanvas(userId, canvasId);
    assertAgentCapability(organizer, AGENT_CAPABILITY_RUNGS.PROPOSE);
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
      },
      { status: 201 },
    );
  },
);
