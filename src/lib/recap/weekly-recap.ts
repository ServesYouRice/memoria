import { z } from "zod";
import {
  ItemType,
  NotificationType,
  type Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import type { OutboxHandler } from "@/lib/outbox/types";
import { enqueueOutboxJob, enqueueOutboxJobs } from "@/lib/outbox/enqueue";
import { suggestPilesForOwner } from "@/lib/agents/piles";
import { sendEmail } from "@/lib/email";
import { weeklyRecapTemplate } from "@/lib/email/templates";
import { env } from "@/lib/env";

/**
 * IMP-070 — the weekly recap. The maintenance cron queues one sweep per ISO
 * week; the sweep queues one job per user; each user job writes at most one
 * `WeeklyRecap` row for that week. The row's unique (user, week) key is the
 * guarantee: only the run that inserts it writes the in-app notification and
 * queues the email, so a repeated sweep, a retried job or a second worker
 * still sends one recap.
 */

export const RECAP_SWEEP_JOB = "recap.weekly-sweep";
export const RECAP_USER_JOB = "recap.weekly";
export const RECAP_EMAIL_JOB = "email.weekly-recap";
/** The user job may wait on an AI pile suggestion. */
export const RECAP_USER_TIMEOUT_MS = 60_000;

export const STALE_LINK_WEEKS_DEFAULT = 6;
export const STALE_LINK_WEEKS_MIN = 1;
export const STALE_LINK_WEEKS_MAX = 52;
/** Stale links one recap lists, and so one "Archive these" acts on. */
export const RECAP_STALE_LIMIT = 100;
/** Saved links one recap lists by name. */
export const RECAP_SAVED_LIST_LIMIT = 10;
/** Saved links offered to the pile suggestion. */
const RECAP_PILE_INPUT_LIMIT = 200;
const RECAP_MAX_PILES = 5;
const SWEEP_PAGE_SIZE = 500;
const DAY_MS = 86_400_000;

/** Monday 00:00 UTC of the ISO week holding `date`. */
export function recapWeekStart(date: Date): Date {
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const daysSinceMonday = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start;
}

/** `YYYY-MM-DD` of the week's Monday; used in dedupe keys. */
export function recapWeekKey(date: Date): string {
  return recapWeekStart(date).toISOString().slice(0, 10);
}

export function staleCutoff(now: Date, staleWeeks: number): Date {
  return new Date(now.getTime() - staleWeeks * 7 * DAY_MS);
}

/**
 * A stale link: a bookmark on one of the user's boards that was neither
 * opened nor edited since the cutoff. Links saved before open tracking began
 * have no `lastOpenedAt` and fall back to their last edit.
 */
export function staleLinkWhere(
  userId: string,
  cutoff: Date,
): Prisma.CanvasItemWhereInput {
  return {
    type: ItemType.BOOKMARK,
    deletedAt: null,
    canvas: { userId, isTemplate: false },
    updatedAt: { lt: cutoff },
    OR: [{ lastOpenedAt: null }, { lastOpenedAt: { lt: cutoff } }],
  };
}

/** Queues this week's sweep; repeated calls in a week are one job. */
export async function enqueueWeeklyRecapSweep(
  tx: Prisma.TransactionClient | PrismaClient,
  now = new Date(),
) {
  const weekKey = recapWeekKey(now);
  return enqueueOutboxJob(tx, {
    type: RECAP_SWEEP_JOB,
    payload: { weekStart: weekKey },
    dedupeKey: `${RECAP_SWEEP_JOB}:${weekKey}`,
    maxAttempts: 5,
  });
}

const sweepPayloadSchema = z
  .object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
  .strict();

const userPayloadSchema = z
  .object({
    userId: z.string().min(1),
    weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();

const emailPayloadSchema = z.object({ recapId: z.string().min(1) }).strict();

/** Fans the week out into one keyed job per user with at least one board. */
export function createWeeklyRecapSweepHandler(
  prisma: PrismaClient,
): OutboxHandler {
  return async (job, context) => {
    const { weekStart } = sweepPayloadSchema.parse(job.payload);
    let cursor: string | undefined;
    for (;;) {
      if (context?.signal.aborted) throw context.signal.reason;
      const users = await prisma.user.findMany({
        where: { canvases: { some: { isTemplate: false } } },
        select: { id: true },
        orderBy: { id: "asc" },
        take: SWEEP_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (users.length === 0) return;
      await enqueueOutboxJobs(
        prisma,
        users.map((user) => ({
          type: RECAP_USER_JOB,
          payload: { userId: user.id, weekStart },
          dedupeKey: `${RECAP_USER_JOB}:${weekStart}:${user.id}`,
          maxAttempts: 5,
        })),
      );
      if (users.length < SWEEP_PAGE_SIZE) return;
      cursor = users[users.length - 1]!.id;
    }
  };
}

interface SavedLink {
  id: string;
  title: string;
  url: string;
}

export interface RecapPile {
  title: string;
  itemIds: string[];
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** Display title and safe URL of a bookmark item, or null when it has none. */
export function describeLink(item: {
  id: string;
  content: unknown;
}): SavedLink | null {
  const content =
    item.content && typeof item.content === "object"
      ? (item.content as Record<string, unknown>)
      : {};
  const url = safeHttpUrl(content.url);
  if (!url) return null;
  const title =
    [content.title, content.siteName].find(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    ) ?? url;
  return { id: item.id, title: title.trim().slice(0, 200), url };
}

export function describeRecapSubject(input: {
  savedCount: number;
  staleCount: number;
  staleWeeks: number;
}) {
  const parts = [
    `${input.savedCount} ${input.savedCount === 1 ? "link" : "links"} saved`,
  ];
  if (input.staleCount > 0) {
    parts.push(`${input.staleCount} not opened in ${input.staleWeeks} weeks`);
  }
  return `Your week: ${parts.join(", ")}`;
}

export interface WeeklyRecapDeps {
  now?: () => Date;
  suggestPiles?: typeof suggestPilesForOwner;
}

/**
 * Writes the user's recap for the given week, once. Returns the recap id it
 * wrote, or null when the week already has one (or the user is gone).
 */
export async function writeWeeklyRecap(
  prisma: PrismaClient,
  input: { userId: string; weekStart: Date },
  deps: WeeklyRecapDeps = {},
): Promise<string | null> {
  const where = {
    userId_weekStart: { userId: input.userId, weekStart: input.weekStart },
  };
  // Cheap early exit so a rerun does not pay for another pile suggestion.
  if (await prisma.weeklyRecap.findUnique({ where, select: { id: true } })) {
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, staleLinkWeeks: true, weeklyRecapEmail: true },
  });
  if (!user) return null;

  const now = deps.now?.() ?? new Date();
  const periodStart = new Date(now.getTime() - 7 * DAY_MS);
  const savedWhere: Prisma.CanvasItemWhereInput = {
    type: ItemType.BOOKMARK,
    deletedAt: null,
    canvas: { userId: user.id, isTemplate: false },
    createdAt: { gte: periodStart, lte: now },
  };
  const staleWeeks = user.staleLinkWeeks;
  const staleWhere = staleLinkWhere(user.id, staleCutoff(now, staleWeeks));

  const [savedCount, savedItems, staleCount, staleItems] = await Promise.all([
    prisma.canvasItem.count({ where: savedWhere }),
    prisma.canvasItem.findMany({
      where: savedWhere,
      select: { id: true, type: true, content: true, tags: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: RECAP_PILE_INPUT_LIMIT,
    }),
    prisma.canvasItem.count({ where: staleWhere }),
    prisma.canvasItem.findMany({
      where: staleWhere,
      select: { id: true },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: RECAP_STALE_LIMIT,
    }),
  ]);

  const savedLinks = savedItems
    .map(describeLink)
    .filter((link): link is SavedLink => link !== null)
    .slice(0, RECAP_SAVED_LIST_LIMIT);
  let suggestedPiles: RecapPile[] = [];
  if (savedItems.length >= 2) {
    const suggest = deps.suggestPiles ?? suggestPilesForOwner;
    const sorted = await suggest({
      userId: user.id,
      items: savedItems,
      maxPiles: RECAP_MAX_PILES,
    });
    suggestedPiles = sorted.piles.map((pile) => ({
      title: pile.title,
      itemIds: pile.itemIds,
    }));
  }

  const hasNews = savedCount > 0 || staleCount > 0;
  return prisma.$transaction(async (tx) => {
    const inserted = await tx.weeklyRecap.createMany({
      data: [
        {
          userId: user.id,
          weekStart: input.weekStart,
          periodStart,
          periodEnd: now,
          savedCount,
          savedLinks: savedLinks as unknown as Prisma.InputJsonValue,
          suggestedPiles: suggestedPiles as unknown as Prisma.InputJsonValue,
          staleWeeks,
          staleCount,
          staleItemIds: staleItems.map((item) => item.id),
        },
      ],
      skipDuplicates: true,
    });
    // Another run won the race for this week.
    if (inserted.count === 0) return null;
    const recap = await tx.weeklyRecap.findUniqueOrThrow({
      where,
      select: { id: true },
    });
    // A quiet week (nothing saved, nothing stale) is recorded but not sent.
    if (!hasNews) return recap.id;

    // The in-app notification is always written; email is the user's opt-in.
    const notification = await tx.notification.create({
      data: {
        recipientId: user.id,
        actorId: user.id,
        type: NotificationType.WEEKLY_RECAP,
        subject: describeRecapSubject({ savedCount, staleCount, staleWeeks }),
      },
      select: { id: true },
    });
    if (user.weeklyRecapEmail) {
      await enqueueOutboxJob(tx, {
        type: RECAP_EMAIL_JOB,
        payload: { recapId: recap.id },
        dedupeKey: `${RECAP_EMAIL_JOB}:${recap.id}`,
      });
    }
    await tx.weeklyRecap.update({
      where: { id: recap.id },
      data: {
        notificationId: notification.id,
        emailQueued: user.weeklyRecapEmail,
      },
    });
    return recap.id;
  });
}

export function createWeeklyRecapHandler(
  prisma: PrismaClient,
  deps: WeeklyRecapDeps = {},
): OutboxHandler {
  return async (job) => {
    const { userId, weekStart } = userPayloadSchema.parse(job.payload);
    await writeWeeklyRecap(
      prisma,
      { userId, weekStart: new Date(`${weekStart}T00:00:00.000Z`) },
      deps,
    );
  };
}

const savedLinksSchema = z.array(
  z.object({ id: z.string(), title: z.string(), url: z.string() }),
);
const pilesSchema = z.array(
  z.object({ title: z.string(), itemIds: z.array(z.string()) }),
);

export function parseRecapSavedLinks(value: unknown): SavedLink[] {
  const parsed = savedLinksSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function parseRecapPiles(value: unknown): RecapPile[] {
  const parsed = pilesSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function createWeeklyRecapEmailHandler(
  prisma: PrismaClient,
  send = sendEmail,
): OutboxHandler {
  return async (job, context) => {
    const { recapId } = emailPayloadSchema.parse(job.payload);
    const recap = await prisma.weeklyRecap.findUnique({
      where: { id: recapId },
      include: {
        user: { select: { email: true, name: true, weeklyRecapEmail: true } },
      },
    });
    // Turned off since the recap was written: in-app only.
    if (!recap || !recap.user.weeklyRecapEmail) return;
    const template = weeklyRecapTemplate({
      userName: recap.user.name || "there",
      savedCount: recap.savedCount,
      savedLinks: parseRecapSavedLinks(recap.savedLinks),
      suggestedPiles: parseRecapPiles(recap.suggestedPiles).map((pile) => ({
        title: pile.title,
        itemCount: pile.itemIds.length,
      })),
      staleCount: recap.staleCount,
      staleWeeks: recap.staleWeeks,
      recapUrl: `${env.AUTH_URL}/recap`,
      settingsUrl: `${env.AUTH_URL}/settings`,
    });
    await send({
      to: { email: recap.user.email, name: recap.user.name || undefined },
      ...template,
      deliveryId: job.id,
      signal: context?.signal,
    });
  };
}
