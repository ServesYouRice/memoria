import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, withAuthValidation } from "@/lib/api/route-handler";
import { BadRequestError } from "@/lib/errors";
import { getAiAvailability } from "@/lib/ai/provider-resolution";
import { webArchiveAvailable } from "@/lib/services/page-copy";
import { taggingRulesSchema } from "@/lib/ai/tagging-rules";

// Settings toggle for background link enrichment (IMP-064): saved links get a
// title, tags and a short summary. Turning it off stops new jobs from being
// enqueued and makes pending ones finish without touching the item. The same
// setting covers keeping each link's page text (IMP-094); the web-archive
// lookup is a separate, off-by-default choice the deployment must allow.
// The person's own tagging rules (IMP-106) live here too; an empty box
// returns to the standard behaviour.

const linkEnrichmentSettingsSchema = z
  .object({
    autoEnrichLinks: z.boolean().optional(),
    webArchiveLookup: z.boolean().optional(),
    taggingRules: taggingRulesSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Change at least one setting.",
  });

async function settingsResponse(userId: string) {
  const [user, availability] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        autoEnrichLinks: true,
        webArchiveLookup: true,
        taggingRules: true,
      },
    }),
    getAiAvailability(userId),
  ]);
  const archiveAvailable = webArchiveAvailable();
  return {
    autoEnrichLinks: Boolean(user?.autoEnrichLinks),
    aiConfigured: availability.configured,
    webArchiveAvailable: archiveAvailable,
    webArchiveLookup: archiveAvailable && Boolean(user?.webArchiveLookup),
    taggingRules: user?.taggingRules ?? "",
  };
}

export const GET = withAuth(async (_request, session) => {
  return NextResponse.json(await settingsResponse(session.user.id));
});

export const PATCH = withAuthValidation(
  linkEnrichmentSettingsSchema,
  async (
    { autoEnrichLinks, webArchiveLookup, taggingRules },
    _request,
    session,
  ) => {
    if (webArchiveLookup && !webArchiveAvailable()) {
      throw new BadRequestError(
        "Web-archive lookups are not available on this Memoria.",
      );
    }
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        ...(autoEnrichLinks !== undefined ? { autoEnrichLinks } : {}),
        ...(webArchiveLookup !== undefined ? { webArchiveLookup } : {}),
        ...(taggingRules !== undefined ? { taggingRules } : {}),
      },
    });
    return NextResponse.json(await settingsResponse(session.user.id));
  },
);
