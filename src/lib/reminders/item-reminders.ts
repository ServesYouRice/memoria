import { z } from "zod";
import {
  ItemType,
  NotificationType,
  type Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import type { OutboxHandler } from "@/lib/outbox/types";
import { enqueueOutboxJob, enqueueOutboxJobs } from "@/lib/outbox/enqueue";
import { getItemTitle } from "@/lib/agents/item-text";
import { sendEmail } from "@/lib/email";
import { itemReminderTemplate } from "@/lib/email/templates";
import { env } from "@/lib/env";

/**
 * IMP-097 — "Remind me" on an item. The maintenance cron queues a sweep every
 * run; the sweep queues one keyed job per due reminder; the fire job marks the
 * reminder fired with a conditional update, and only the run that wins that
 * update writes the notification and queues the email. A repeated sweep, a
 * retried job or a second worker therefore still reminds once.
 */

export const REMINDER_SWEEP_JOB = "reminders.sweep";
export const REMINDER_FIRE_JOB = "reminder.fire";
export const REMINDER_EMAIL_JOB = "email.item-reminder";

/** The cron runs every 15 minutes; one sweep per window is enough. */
const SWEEP_WINDOW_MS = 15 * 60_000;
const SWEEP_PAGE_SIZE = 500;
/** How far ahead a reminder may be set. */
export const REMINDER_MAX_AHEAD_MS = 5 * 366 * 86_400_000;
const DAY_MS = 86_400_000;
/** "Something old": not opened for at least this long. */
export const SOMETHING_OLD_DAYS = 30;

export function reminderUrl(canvasId: string, itemId: string) {
  return `/canvas/${encodeURIComponent(canvasId)}?item=${encodeURIComponent(itemId)}`;
}

/** Queues this window's sweep; repeated calls in a window are one job. */
export async function enqueueReminderSweep(
  tx: Prisma.TransactionClient | PrismaClient,
  now = new Date(),
) {
  const window = Math.floor(now.getTime() / SWEEP_WINDOW_MS);
  return enqueueOutboxJob(tx, {
    type: REMINDER_SWEEP_JOB,
    payload: {},
    dedupeKey: `${REMINDER_SWEEP_JOB}:${window}`,
    maxAttempts: 5,
  });
}

export function reminderFireDedupeKey(reminderId: string, remindAt: Date) {
  return `${REMINDER_FIRE_JOB}:${reminderId}:${remindAt.getTime()}`;
}

/** Due, not yet fired, not cancelled. */
export function dueReminderWhere(now: Date): Prisma.ItemReminderWhereInput {
  return { remindAt: { lte: now }, firedAt: null, cancelledAt: null };
}

/** Fans due reminders out into one keyed fire job each. */
export function createReminderSweepHandler(
  prisma: PrismaClient,
  now: () => Date = () => new Date(),
): OutboxHandler {
  return async (_job, context) => {
    const at = now();
    let cursor: string | undefined;
    for (;;) {
      if (context?.signal.aborted) throw context.signal.reason;
      const due = await prisma.itemReminder.findMany({
        where: dueReminderWhere(at),
        select: { id: true, remindAt: true },
        orderBy: { id: "asc" },
        take: SWEEP_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (due.length === 0) return;
      await enqueueOutboxJobs(
        prisma,
        due.map((reminder) => ({
          type: REMINDER_FIRE_JOB,
          payload: {
            reminderId: reminder.id,
            remindAt: reminder.remindAt.toISOString(),
          },
          dedupeKey: reminderFireDedupeKey(reminder.id, reminder.remindAt),
          maxAttempts: 5,
        })),
      );
      if (due.length < SWEEP_PAGE_SIZE) return;
      cursor = due[due.length - 1]!.id;
    }
  };
}

const firePayloadSchema = z
  .object({ reminderId: z.string().min(1), remindAt: z.string().datetime() })
  .strict();

/**
 * Whether the person may still see the item the reminder points at: it is
 * live and they own its canvas or hold a share on it (the same rule as
 * `getCanvasAccess`, which the worker cannot import: it pulls in Next.js).
 */
async function canStillSee(
  client: Pick<Prisma.TransactionClient, "canvas">,
  userId: string,
  item: { canvasId: string; deletedAt: Date | null },
) {
  if (item.deletedAt) return false;
  const canvas = await client.canvas.findFirst({
    where: {
      id: item.canvasId,
      OR: [{ userId }, { shares: { some: { recipientId: userId } } }],
    },
    select: { id: true },
  });
  return canvas !== null;
}

/** Email is opt-in for reminders: only a stored "email on" choice sends one. */
async function wantsReminderEmail(
  client: Pick<Prisma.TransactionClient, "notificationPreference">,
  userId: string,
) {
  const preference = await client.notificationPreference.findUnique({
    where: {
      userId_type: { userId, type: NotificationType.ITEM_REMINDER },
    },
    select: { emailEnabled: true },
  });
  return preference?.emailEnabled === true;
}

export type ReminderFireResult = "fired" | "cancelled" | "skipped" | "not-due";

/**
 * Fires one reminder, once. Access is checked now, not when it was set: a
 * deleted item or a lost share cancels the reminder instead.
 */
export async function fireItemReminder(
  prisma: PrismaClient,
  input: { reminderId: string; remindAt: Date },
  now = new Date(),
): Promise<ReminderFireResult> {
  return prisma.$transaction(async (tx) => {
    const reminder = await tx.itemReminder.findUnique({
      where: { id: input.reminderId },
      include: {
        item: {
          select: {
            id: true,
            canvasId: true,
            deletedAt: true,
            type: true,
            content: true,
          },
        },
      },
    });
    if (
      !reminder ||
      reminder.firedAt ||
      reminder.cancelledAt ||
      reminder.remindAt.getTime() !== input.remindAt.getTime()
    ) {
      // Gone, already sent, cancelled, or moved to another time (whose own
      // job will fire it).
      return "skipped";
    }
    if (reminder.remindAt > now) return "not-due";
    const pending = {
      id: reminder.id,
      firedAt: null,
      cancelledAt: null,
      remindAt: reminder.remindAt,
    };
    if (!(await canStillSee(tx, reminder.userId, reminder.item))) {
      await tx.itemReminder.updateMany({
        where: pending,
        data: { cancelledAt: now },
      });
      return "cancelled";
    }
    const won = await tx.itemReminder.updateMany({
      where: pending,
      data: { firedAt: now },
    });
    if (won.count === 0) return "skipped";

    const preference = await tx.notificationPreference.findUnique({
      where: {
        userId_type: {
          userId: reminder.userId,
          type: NotificationType.ITEM_REMINDER,
        },
      },
      select: { inAppEnabled: true, emailEnabled: true },
    });
    const title = getItemTitle(reminder.item);
    if (preference?.inAppEnabled !== false) {
      await tx.notification.create({
        data: {
          recipientId: reminder.userId,
          actorId: reminder.userId,
          canvasId: reminder.item.canvasId,
          itemId: reminder.item.id,
          type: NotificationType.ITEM_REMINDER,
          subject: `Reminder: ${title}`,
        },
      });
    }
    if (preference?.emailEnabled === true) {
      await enqueueOutboxJob(tx, {
        type: REMINDER_EMAIL_JOB,
        payload: {
          reminderId: reminder.id,
          remindAt: reminder.remindAt.toISOString(),
        },
        dedupeKey: `${REMINDER_EMAIL_JOB}:${reminder.id}:${reminder.remindAt.getTime()}`,
        maxAttempts: 5,
      });
    }
    return "fired";
  });
}

export function createReminderFireHandler(
  prisma: PrismaClient,
  now: () => Date = () => new Date(),
): OutboxHandler {
  return async (job) => {
    const { reminderId, remindAt } = firePayloadSchema.parse(job.payload);
    await fireItemReminder(
      prisma,
      { reminderId, remindAt: new Date(remindAt) },
      now(),
    );
  };
}

export function createReminderEmailHandler(
  prisma: PrismaClient,
  send = sendEmail,
): OutboxHandler {
  return async (job, context) => {
    const { reminderId, remindAt } = firePayloadSchema.parse(job.payload);
    const reminder = await prisma.itemReminder.findUnique({
      where: { id: reminderId },
      include: {
        user: { select: { email: true, name: true } },
        item: {
          select: {
            id: true,
            canvasId: true,
            deletedAt: true,
            type: true,
            content: true,
            canvas: { select: { name: true } },
          },
        },
      },
    });
    if (
      !reminder?.firedAt ||
      reminder.cancelledAt ||
      reminder.remindAt.getTime() !== new Date(remindAt).getTime()
    )
      return;
    // The person may have turned email off or lost access since it fired.
    if (!(await wantsReminderEmail(prisma, reminder.userId))) return;
    if (!(await canStillSee(prisma, reminder.userId, reminder.item))) return;
    const template = itemReminderTemplate({
      userName: reminder.user.name || reminder.user.email,
      itemTitle: getItemTitle(reminder.item),
      canvasName: reminder.item.canvas.name,
      itemUrl: `${env.AUTH_URL}${reminderUrl(reminder.item.canvasId, reminder.item.id)}`,
      settingsUrl: `${env.AUTH_URL}/settings`,
    });
    await send({
      to: { email: reminder.user.email, name: reminder.user.name || undefined },
      ...template,
      deliveryId: job.id,
      signal: context?.signal,
    });
  };
}

/** Types "Something old" never offers: connectors, ink and containers. */
const NOT_OLD_TYPES: ItemType[] = [
  ItemType.ARROW,
  ItemType.DRAWING,
  ItemType.FRAME,
];

/**
 * "Something old" (IMP-097): one item on the person's own canvases that was
 * not opened for at least 30 days, picked at random. No AI.
 */
export async function pickSomethingOld(
  prisma: PrismaClient,
  input: { userId: string; exclude?: string[]; now?: Date },
  random: () => number = Math.random,
) {
  const cutoff = new Date(
    (input.now ?? new Date()).getTime() - SOMETHING_OLD_DAYS * DAY_MS,
  );
  const where: Prisma.CanvasItemWhereInput = {
    deletedAt: null,
    type: { notIn: NOT_OLD_TYPES },
    canvas: { userId: input.userId, isTemplate: false },
    ...(input.exclude?.length ? { id: { notIn: input.exclude } } : {}),
    OR: [
      { lastOpenedAt: { lt: cutoff } },
      // Never opened since tracking began: fall back to when it was saved.
      { lastOpenedAt: null, createdAt: { lt: cutoff } },
    ],
  };
  const count = await prisma.canvasItem.count({ where });
  if (count === 0) return null;
  const [item] = await prisma.canvasItem.findMany({
    where,
    select: {
      id: true,
      canvasId: true,
      type: true,
      content: true,
      createdAt: true,
      lastOpenedAt: true,
      canvas: { select: { name: true } },
    },
    orderBy: { id: "asc" },
    skip: Math.min(count - 1, Math.floor(random() * count)),
    take: 1,
  });
  if (!item) return null;
  return {
    id: item.id,
    canvasId: item.canvasId,
    canvasName: item.canvas.name,
    type: item.type,
    title: getItemTitle(item),
    url: reminderUrl(item.canvasId, item.id),
    savedAt: item.createdAt.toISOString(),
    lastOpenedAt: item.lastOpenedAt?.toISOString() ?? null,
  };
}
