import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import {
  acceptHomeBoardSuggestion,
  dismissHomeBoardSuggestion,
  undoHomeBoardMove,
} from "@/lib/agents/home-board";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

const actionSchema = z
  .object({ action: z.enum(["accept", "dismiss", "undo"]) })
  .strict();

/**
 * Accept, dismiss or undo an item's suggested home board (IMP-066). Each call
 * is scoped to the signed-in owner; accepting runs the approved-move path and
 * undo reverts its ChangeSet.
 */
export const POST = withApiHandler(
  async (request: Request, { params }: RouteContext) => {
    const { userId } = await requireAuth();
    const { itemId } = await params;
    const { action } = actionSchema.parse(await request.json());
    const input = { userId, itemId: z.string().min(1).max(64).parse(itemId) };
    const result =
      action === "accept"
        ? await acceptHomeBoardSuggestion(input)
        : action === "dismiss"
          ? await dismissHomeBoardSuggestion(input)
          : await undoHomeBoardMove(input);
    return NextResponse.json(result);
  },
);
