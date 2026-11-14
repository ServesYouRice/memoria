import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { ItemType } from "@/types/canvas";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { pollContentSchema } from "@/lib/validation/canvas-item";
import { getRedisClient } from "@/lib/cache/redis-client";
import { canvasChannel } from "@/lib/collaboration/channels";
import { createLogger } from "@/lib/logger";
import type { PollResult } from "./shared";
import { POLL_MAX_CHOICES } from "./limits";

export type { PollResult } from "./shared";

/**
 * IMP-104: poll votes are counted on the server. The shared document carries
 * only the question and the choices; who voted for what lives in `PollVote`
 * and is written only through the vote route, for the signed-in person.
 */

const logger = createLogger("polls");

type Store = PrismaClient | Prisma.TransactionClient;

export const pollVoteSchema = z
  .object({
    /** The person's whole answer; an empty list withdraws their vote. */
    choiceIds: z.array(z.string().min(1).max(50)).max(POLL_MAX_CHOICES),
  })
  .strict();

export const pollCloseSchema = z.object({ closed: z.boolean() }).strict();

interface PollRow {
  id: string;
  canvasId: string;
  content: z.infer<typeof pollContentSchema>;
  closedAt: Date | null;
}

async function loadPoll(store: Store, itemId: string): Promise<PollRow> {
  const item = await store.canvasItem.findFirst({
    where: { id: itemId, deletedAt: null, type: ItemType.POLL },
    select: {
      id: true,
      canvasId: true,
      content: true,
      pollClosure: { select: { closedAt: true } },
    },
  });
  const content = item ? pollContentSchema.safeParse(item.content) : null;
  if (!item || !content?.success) throw new NotFoundError("Poll not found");
  return {
    id: item.id,
    canvasId: item.canvasId,
    content: content.data,
    closedAt: item.pollClosure?.closedAt ?? null,
  };
}

async function resultsFor(
  store: Store,
  polls: PollRow[],
  userId: string,
): Promise<PollResult[]> {
  if (polls.length === 0) return [];
  const votes = await store.pollVote.findMany({
    where: { itemId: { in: polls.map((poll) => poll.id) } },
    select: { itemId: true, userId: true, choiceId: true },
  });
  return polls.map((poll) => {
    const choiceIds = new Set(poll.content.options.map((option) => option.id));
    const counts: Record<string, number> = {};
    for (const id of choiceIds) counts[id] = 0;
    const voters = new Set<string>();
    const mine: string[] = [];
    for (const vote of votes) {
      // A vote for a choice later removed from the poll no longer counts.
      if (vote.itemId !== poll.id || !choiceIds.has(vote.choiceId)) continue;
      counts[vote.choiceId] = (counts[vote.choiceId] ?? 0) + 1;
      voters.add(vote.userId);
      if (vote.userId === userId) mine.push(vote.choiceId);
    }
    return {
      itemId: poll.id,
      multipleChoice: poll.content.multipleChoice === true,
      closed: poll.closedAt !== null,
      closedAt: poll.closedAt?.toISOString() ?? null,
      counts,
      voters: voters.size,
      myChoiceIds: mine,
    };
  });
}

export async function readPollResult(
  store: Store,
  itemId: string,
  userId: string,
): Promise<PollResult> {
  const [result] = await resultsFor(
    store,
    [await loadPoll(store, itemId)],
    userId,
  );
  return result!;
}

/** Every live poll on a canvas, for the board and for exports. */
export async function readCanvasPollResults(
  store: Store,
  canvasId: string,
  userId: string,
): Promise<PollResult[]> {
  const items = await store.canvasItem.findMany({
    where: { canvasId, deletedAt: null, type: ItemType.POLL },
    select: {
      id: true,
      canvasId: true,
      content: true,
      pollClosure: { select: { closedAt: true } },
    },
  });
  const polls: PollRow[] = [];
  for (const item of items) {
    const content = pollContentSchema.safeParse(item.content);
    if (!content.success) continue;
    polls.push({
      id: item.id,
      canvasId: item.canvasId,
      content: content.data,
      closedAt: item.pollClosure?.closedAt ?? null,
    });
  }
  return resultsFor(store, polls, userId);
}

/**
 * Replace the person's answer with `choiceIds`. One transaction per person
 * and poll at a time, so two quick clicks can never leave two votes on a
 * single-choice poll.
 */
export async function castPollVote(
  prisma: PrismaClient,
  input: { itemId: string; userId: string; choiceIds: string[] },
): Promise<{ canvasId: string; result: PollResult }> {
  const wanted = [...new Set(input.choiceIds)];
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`poll:${input.itemId}:${input.userId}`}, 0))`;
    const poll = await loadPoll(tx, input.itemId);
    if (poll.closedAt) throw new ConflictError("This poll is closed.");
    const choiceIds = new Set(poll.content.options.map((option) => option.id));
    if (wanted.some((id) => !choiceIds.has(id)))
      throw new ValidationError("That choice is not in this poll.");
    if (!poll.content.multipleChoice && wanted.length > 1)
      throw new ValidationError("This poll takes one choice.");

    await tx.pollVote.deleteMany({
      where: {
        itemId: poll.id,
        userId: input.userId,
        choiceId: { notIn: wanted },
      },
    });
    if (wanted.length > 0) {
      await tx.pollVote.createMany({
        data: wanted.map((choiceId) => ({
          itemId: poll.id,
          userId: input.userId,
          choiceId,
        })),
        skipDuplicates: true,
      });
    }
    const [result] = await resultsFor(tx, [poll], input.userId);
    return { canvasId: poll.canvasId, result: result! };
  });
}

export async function setPollClosed(
  prisma: PrismaClient,
  input: { itemId: string; userId: string; closed: boolean },
): Promise<{ canvasId: string; result: PollResult }> {
  return prisma.$transaction(async (tx) => {
    const poll = await loadPoll(tx, input.itemId);
    if (input.closed) {
      await tx.pollClosure.upsert({
        where: { itemId: poll.id },
        create: { itemId: poll.id, closedById: input.userId },
        update: {},
      });
    } else {
      await tx.pollClosure.deleteMany({ where: { itemId: poll.id } });
    }
    return {
      canvasId: poll.canvasId,
      result: await readPollResult(tx, poll.id, input.userId),
    };
  });
}

/**
 * Tell open boards that a poll's counts changed. It carries no tally: each
 * board reads the counts through the authorized results route. Best effort;
 * the board also re-reads when it reconnects.
 */
export async function publishPollChanged(
  canvasId: string,
  itemId: string,
  redis = getRedisClient(),
): Promise<void> {
  if (!redis) return;
  try {
    await redis.publish(
      canvasChannel(canvasId),
      JSON.stringify({
        type: "message",
        canvasId,
        instanceId: `poll:${itemId}:${Date.now()}`,
        payload: { type: "poll-changed", itemId },
        timestamp: Date.now(),
      }),
    );
  } catch (error) {
    logger.warn({ error, canvasId }, "Poll change notice was not published");
  }
}
