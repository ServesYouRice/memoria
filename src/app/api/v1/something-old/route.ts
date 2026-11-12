import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { prisma } from "@/lib/db";
import { pickSomethingOld } from "@/lib/reminders/item-reminders";

const querySchema = z.object({
  exclude: z.array(z.string().min(1).max(64)).max(50),
});

/**
 * IMP-097 — "Something old": one of the caller's items not opened for at
 * least 30 days, picked at random. `exclude` skips the ones already shown,
 * for "Show another". No AI.
 */
export const GET = withApiHandler(async (request: Request) => {
  const { userId } = await requireAuth();
  const { searchParams } = new URL(request.url);
  const { exclude } = querySchema.parse({
    exclude: searchParams.getAll("exclude"),
  });
  const item = await pickSomethingOld(prisma, { userId, exclude });
  return NextResponse.json({ item });
});
