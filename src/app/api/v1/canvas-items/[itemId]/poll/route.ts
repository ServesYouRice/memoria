import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth, withAuthValidation } from "@/lib/api/route-handler";
import { requireItemAccess } from "@/lib/api/auth";
import { ForbiddenError } from "@/lib/errors";
import { requirePollsEnabled } from "@/lib/polls/availability";
import {
  castPollVote,
  pollCloseSchema,
  pollVoteSchema,
  publishPollChanged,
  readPollResult,
  setPollClosed,
} from "@/lib/polls/votes";
import { ItemType } from "@/types/canvas";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

const NO_STORE = { "Cache-Control": "no-store" };

/** GET /api/v1/canvas-items/{itemId}/poll (IMP-104): one poll's counts. */
export const GET = withAuth<unknown, RouteContext>(
  async (_request, session, { params }) => {
    requirePollsEnabled(ItemType.POLL);
    const { itemId } = await params;
    await requireItemAccess(
      itemId,
      session.user.id,
      session.user.email ?? "",
      "VIEW",
    );
    const result = await readPollResult(prisma, itemId, session.user.id);
    return NextResponse.json(result, { headers: NO_STORE });
  },
);

/**
 * PUT /api/v1/canvas-items/{itemId}/poll: the caller's whole answer
 * (`choiceIds`, empty to withdraw). Anyone who may view the canvas may vote,
 * only for themselves: the voter is always the signed-in person.
 */
export const PUT = withAuthValidation(
  pollVoteSchema,
  async (data, _request, session, context) => {
    requirePollsEnabled(ItemType.POLL);
    const { itemId } = await (context as RouteContext).params;
    await requireItemAccess(
      itemId,
      session.user.id,
      session.user.email ?? "",
      "VIEW",
    );
    const { canvasId, result } = await castPollVote(prisma, {
      itemId,
      userId: session.user.id,
      choiceIds: data.choiceIds,
    });
    await publishPollChanged(canvasId, itemId);
    return NextResponse.json(result, { headers: NO_STORE });
  },
);

/** PATCH /api/v1/canvas-items/{itemId}/poll: the canvas owner closes or reopens it. */
export const PATCH = withAuthValidation(
  pollCloseSchema,
  async (data, _request, session, context) => {
    requirePollsEnabled(ItemType.POLL);
    const { itemId } = await (context as RouteContext).params;
    const access = await requireItemAccess(
      itemId,
      session.user.id,
      session.user.email ?? "",
      "VIEW",
    );
    if (access !== "OWNER")
      throw new ForbiddenError("Only the canvas owner can close a poll.");
    const { canvasId, result } = await setPollClosed(prisma, {
      itemId,
      userId: session.user.id,
      closed: data.closed,
    });
    await publishPollChanged(canvasId, itemId);
    return NextResponse.json(result, { headers: NO_STORE });
  },
);
