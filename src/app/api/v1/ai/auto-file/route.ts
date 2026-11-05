import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, withAuthValidation } from "@/lib/api/route-handler";
import { AUTO_FILE_CONFIDENCE } from "@/lib/agents/home-board";

// Settings toggle for "file automatically" (IMP-066): an Inbox item whose
// suggested home board is a confident match moves there on its own. Every
// move stays one-step undoable from the Inbox.

const autoFileSettingsSchema = z
  .object({ autoFileItems: z.boolean() })
  .strict();

async function settingsResponse(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { autoFileItems: true },
  });
  return {
    autoFileItems: Boolean(user?.autoFileItems),
    confidenceThreshold: AUTO_FILE_CONFIDENCE,
  };
}

export const GET = withAuth(async (_request, session) => {
  return NextResponse.json(await settingsResponse(session.user.id));
});

export const PATCH = withAuthValidation(
  autoFileSettingsSchema,
  async ({ autoFileItems }, _request, session) => {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { autoFileItems },
    });
    return NextResponse.json(await settingsResponse(session.user.id));
  },
);
