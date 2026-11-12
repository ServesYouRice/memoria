import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { prisma } from "@/lib/db";
import { getItemTitle } from "@/lib/agents/item-text";
import { reminderUrl } from "@/lib/reminders/item-reminders";

const LIST_LIMIT = 200;

/**
 * IMP-097 — the caller's upcoming reminders. Reminders on deleted items or on
 * canvases the caller can no longer open are not listed (and are cancelled
 * when they come due).
 */
export const GET = withApiHandler(async () => {
  const { userId } = await requireAuth();
  const reminders = await prisma.itemReminder.findMany({
    where: {
      userId,
      firedAt: null,
      cancelledAt: null,
      item: {
        deletedAt: null,
        canvas: {
          OR: [{ userId }, { shares: { some: { recipientId: userId } } }],
        },
      },
    },
    select: {
      id: true,
      remindAt: true,
      item: {
        select: {
          id: true,
          canvasId: true,
          type: true,
          content: true,
          canvas: { select: { name: true } },
        },
      },
    },
    orderBy: [{ remindAt: "asc" }, { id: "asc" }],
    take: LIST_LIMIT,
  });
  return NextResponse.json({
    reminders: reminders.map((reminder) => ({
      id: reminder.id,
      remindAt: reminder.remindAt.toISOString(),
      itemId: reminder.item.id,
      canvasId: reminder.item.canvasId,
      canvasName: reminder.item.canvas.name,
      title: getItemTitle(reminder.item),
      url: reminderUrl(reminder.item.canvasId, reminder.item.id),
    })),
  });
});
