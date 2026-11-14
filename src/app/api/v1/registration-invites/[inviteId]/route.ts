/**
 * DELETE /api/v1/registration-invites/:inviteId (IMP-153)
 * Takes back an unused sign-up invite. Owner only; anyone else gets a 404.
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { NotFoundError } from "@/lib/errors";
import {
  requireInstanceOwner,
  revokeRegistrationInvite,
} from "@/lib/auth/registration-invites";

interface RouteContext {
  params: Promise<{ inviteId: string }>;
}

const inviteIdSchema = z.string().cuid();

export const DELETE = withApiHandler(
  async (_request: NextRequest, { params }: RouteContext) => {
    const { userId } = await requireAuth();
    await requireInstanceOwner(prisma, userId);

    const parsed = inviteIdSchema.safeParse((await params).inviteId);
    if (!parsed.success) throw new NotFoundError("Invite not found");

    await revokeRegistrationInvite(prisma, parsed.data);
    return NextResponse.json({ success: true });
  },
);
