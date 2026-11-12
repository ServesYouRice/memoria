import { NextResponse } from "next/server";
import { z } from "zod";
import { getCanvasAccess, requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { REMINDER_MAX_AHEAD_MS } from "@/lib/reminders/item-reminders";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

const paramsSchema = z.object({ itemId: z.string().min(1).max(64) });
const bodySchema = z.object({ remindAt: z.string().datetime() }).strict();
/** A reminder set "now" from a slow phone is still in the future. */
const CLOCK_SKEW_MS = 60_000;

/** The live item, or 404 when it is gone or the caller cannot see it. */
async function visibleItem(itemId: string, userId: string, email: string) {
  const item = await prisma.canvasItem.findFirst({
    where: { id: itemId, deletedAt: null },
    select: { id: true, canvasId: true },
  });
  if (!item || (await getCanvasAccess(item.canvasId, userId, email)) === "NONE")
    throw new NotFoundError("Item not found.");
  return item;
}

function present(
  reminder: { id: string; remindAt: Date; firedAt: Date | null } | null,
) {
  return reminder && !reminder.firedAt
    ? { id: reminder.id, remindAt: reminder.remindAt.toISOString() }
    : null;
}

/** IMP-097 — the caller's pending reminder on this item, if any. */
export const GET = withApiHandler(
  async (_request: Request, { params }: RouteContext) => {
    const { userId, email } = await requireAuth();
    const { itemId } = paramsSchema.parse(await params);
    await visibleItem(itemId, userId, email);
    const reminder = await prisma.itemReminder.findFirst({
      where: { userId, itemId, cancelledAt: null },
      select: { id: true, remindAt: true, firedAt: true },
    });
    return NextResponse.json({ reminder: present(reminder) });
  },
);

/** Sets or moves the caller's reminder. Anyone who can see the item may. */
export const PUT = withApiHandler(
  async (request: Request, { params }: RouteContext) => {
    const { userId, email } = await requireAuth();
    const { itemId } = paramsSchema.parse(await params);
    const { remindAt: raw } = bodySchema.parse(await request.json());
    const remindAt = new Date(raw);
    const now = Date.now();
    if (remindAt.getTime() < now - CLOCK_SKEW_MS)
      throw new ValidationError("Pick a time in the future.");
    if (remindAt.getTime() > now + REMINDER_MAX_AHEAD_MS)
      throw new ValidationError("Pick a time within the next five years.");
    await visibleItem(itemId, userId, email);
    const reminder = await prisma.itemReminder.upsert({
      where: { userId_itemId: { userId, itemId } },
      create: { userId, itemId, remindAt },
      update: { remindAt, firedAt: null, cancelledAt: null },
      select: { id: true, remindAt: true, firedAt: true },
    });
    return NextResponse.json({ reminder: present(reminder) });
  },
);

/** Cancels the caller's reminder; cancelling none is not an error. */
export const DELETE = withApiHandler(
  async (_request: Request, { params }: RouteContext) => {
    const { userId } = await requireAuth();
    const { itemId } = paramsSchema.parse(await params);
    await prisma.itemReminder.updateMany({
      where: { userId, itemId, firedAt: null, cancelledAt: null },
      data: { cancelledAt: new Date() },
    });
    return new NextResponse(null, { status: 204 });
  },
);
