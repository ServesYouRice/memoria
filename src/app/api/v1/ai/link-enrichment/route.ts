import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, withAuthValidation } from "@/lib/api/route-handler";
import { getAiAvailability } from "@/lib/ai/provider-resolution";

// Settings toggle for background link enrichment (IMP-064): saved links get a
// title, tags and a short summary. Turning it off stops new jobs from being
// enqueued and makes pending ones finish without touching the item.

const linkEnrichmentSettingsSchema = z
  .object({ autoEnrichLinks: z.boolean() })
  .strict();

async function settingsResponse(userId: string) {
  const [user, availability] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { autoEnrichLinks: true },
    }),
    getAiAvailability(userId),
  ]);
  return {
    autoEnrichLinks: Boolean(user?.autoEnrichLinks),
    aiConfigured: availability.configured,
  };
}

export const GET = withAuth(async (_request, session) => {
  return NextResponse.json(await settingsResponse(session.user.id));
});

export const PATCH = withAuthValidation(
  linkEnrichmentSettingsSchema,
  async ({ autoEnrichLinks }, _request, session) => {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { autoEnrichLinks },
    });
    return NextResponse.json(await settingsResponse(session.user.id));
  },
);
