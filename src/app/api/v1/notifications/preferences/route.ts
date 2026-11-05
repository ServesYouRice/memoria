import { NotificationType } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { prisma } from "@/lib/db";

// The weekly recap (IMP-070) is always in the app and has its own email
// opt-in under Settings → Weekly recap, so it is not a per-type preference.
const PREFERENCE_TYPES = Object.values(NotificationType).filter(
  (type) => type !== NotificationType.WEEKLY_RECAP,
);

const updateSchema = z
  .object({
    type: z
      .nativeEnum(NotificationType)
      .refine((type) => type !== NotificationType.WEEKLY_RECAP, {
        message: "The weekly recap is set under Settings → Weekly recap.",
      }),
    inAppEnabled: z.boolean(),
    emailEnabled: z.boolean(),
  })
  .strict();

export const GET = withApiHandler(async () => {
  const { userId } = await requireAuth();
  const stored = await prisma.notificationPreference.findMany({
    where: { userId },
  });
  const byType = new Map(
    stored.map((preference) => [preference.type, preference]),
  );
  return NextResponse.json({
    preferences: PREFERENCE_TYPES.map((type) => ({
      type,
      inAppEnabled: byType.get(type)?.inAppEnabled ?? true,
      emailEnabled: byType.get(type)?.emailEnabled ?? true,
    })),
  });
});

export const PUT = withApiHandler(async (request) => {
  const { userId } = await requireAuth();
  const value = updateSchema.parse(await request.json());
  const preference = await prisma.notificationPreference.upsert({
    where: { userId_type: { userId, type: value.type } },
    create: { userId, ...value },
    update: {
      inAppEnabled: value.inAppEnabled,
      emailEnabled: value.emailEnabled,
    },
  });
  return NextResponse.json({
    type: preference.type,
    inAppEnabled: preference.inAppEnabled,
    emailEnabled: preference.emailEnabled,
  });
});
