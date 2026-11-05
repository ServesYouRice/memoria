import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, withAuthValidation } from "@/lib/api/route-handler";
import {
  STALE_LINK_WEEKS_MAX,
  STALE_LINK_WEEKS_MIN,
} from "@/lib/recap/weekly-recap";

// Weekly recap settings (IMP-070): the recap is always in the app; email is
// opt-in. A link counts as stale after this many weeks without being opened.

const recapSettingsSchema = z
  .object({
    weeklyRecapEmail: z.boolean().optional(),
    staleLinkWeeks: z
      .number()
      .int()
      .min(STALE_LINK_WEEKS_MIN)
      .max(STALE_LINK_WEEKS_MAX)
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.weeklyRecapEmail !== undefined ||
      value.staleLinkWeeks !== undefined,
    { message: "Nothing to change" },
  );

const settingsSelect = { weeklyRecapEmail: true, staleLinkWeeks: true };

export const GET = withAuth(async (_request, session) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: settingsSelect,
  });
  return NextResponse.json(user);
});

export const PATCH = withAuthValidation(
  recapSettingsSchema,
  async (data, _request, session) => {
    const user = await prisma.user.update({
      where: { id: session.user.id },
      data,
      select: settingsSelect,
    });
    return NextResponse.json(user);
  },
);
