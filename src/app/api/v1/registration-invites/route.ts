/**
 * Sign-up invites (IMP-153, DEC-024)
 * GET  /api/v1/registration-invites  - the owner's invites
 * POST /api/v1/registration-invites  - invite an email; the link is returned once
 *
 * Only the owner of this Memoria (the first account) may use these; anyone
 * else gets a 404.
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { fromZodError } from "@/lib/errors";
import {
  INVITE_MAX_TTL_DAYS,
  INVITE_TTL_DAYS,
  createRegistrationInvite,
  isInviteMailConfigured,
  listRegistrationInvites,
  registrationInviteUrl,
  requireInstanceOwner,
} from "@/lib/auth/registration-invites";

const createInviteSchema = z
  .object({
    email: z.string().trim().email().max(254),
    expiresInDays: z
      .number()
      .int()
      .min(1)
      .max(INVITE_MAX_TTL_DAYS)
      .default(INVITE_TTL_DAYS),
  })
  .strict();

export const GET = withApiHandler(async () => {
  const { userId } = await requireAuth();
  await requireInstanceOwner(prisma, userId);

  const invites = await listRegistrationInvites(prisma);
  return NextResponse.json({
    invites,
    registrationMode: env.REGISTRATION_MODE,
    mailConfigured: isInviteMailConfigured(),
  });
});

export const POST = withApiHandler(async (request: NextRequest) => {
  const { userId } = await requireAuth();
  await requireInstanceOwner(prisma, userId);

  const parsed = createInviteSchema.safeParse(await request.json());
  if (!parsed.success) throw fromZodError(parsed.error);

  const { invite, token, emailQueued } = await createRegistrationInvite(
    prisma,
    {
      email: parsed.data.email,
      ttlDays: parsed.data.expiresInDays,
      sendEmail: isInviteMailConfigured(),
    },
  );

  return NextResponse.json(
    {
      invite,
      // Shown once: only the token's hash is stored.
      inviteUrl: registrationInviteUrl(env.AUTH_URL, token, invite.email),
      emailQueued,
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
});
