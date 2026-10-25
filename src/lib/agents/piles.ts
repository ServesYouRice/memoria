import {
  AgentActionKind,
  AgentActionStatus,
  AgentProfileStatus,
  ChangeSetStatus,
  Prisma,
  SuggestionKind,
} from "@/generated/prisma/client";
import { createHash } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { BadRequestError, NotFoundError } from "@/lib/errors";
import { AGENT_CAPABILITY_RUNGS } from "@/lib/agents/constants";
import { assertAgentCapability, assertCanvasScope } from "@/lib/agents/policy";
import {
  createSuggestionRecord,
  type ActorContext,
} from "@/lib/agents/service-core";
import { getItemPlainText, getItemUrl } from "@/lib/agents/item-text";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import { assertCanvasItemCapacity } from "@/lib/policy/capacity";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import { ItemType } from "@/types/canvas";

export const PILES_SUGGESTION_KIND = "canvas-piles";
export const ORGANIZER_PROFILE_NAME = "Memoria organizer";

const MAX_PILES = 12;
const MAX_PILE_ITEMS = 500;

export const pilesSchema = z
  .array(
    z.object({
      title: z.string().trim().min(1).max(80),
      itemIds: z.array(z.string().min(1).max(64)).min(1).max(MAX_PILE_ITEMS),
    }),
  )
  .min(1)
  .max(MAX_PILES)
  .superRefine((piles, ctx) => {
    const seen = new Set<string>();
    let total = 0;
    for (const pile of piles) {
      for (const itemId of pile.itemIds) {
        total += 1;
        if (seen.has(itemId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Item ${itemId} is in more than one pile.`,
          });
          return;
        }
        seen.add(itemId);
      }
    }
    if (total > MAX_PILE_ITEMS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Piles may hold at most ${MAX_PILE_ITEMS} items in total.`,
      });
    }
  });

export type PileInput = z.infer<typeof pilesSchema>[number];

export const pilesSuggestionPayloadSchema = z.object({
  kind: z.literal(PILES_SUGGESTION_KIND),
  canvasId: z.string().min(1),
  piles: pilesSchema,
});

// ---------------------------------------------------------------------------
// Layout: each pile becomes a titled frame with its items in a tidy grid.
// ---------------------------------------------------------------------------

const FRAME_PADDING = 40;
const FRAME_HEADER = 56;
const ITEM_GAP = 24;
const FRAME_GAP = 120;
const FRAMES_PER_ROW = 3;
const MAX_COLUMNS = 4;

interface LayoutItem {
  id: string;
  width: number;
  height: number;
}

export interface PileLayout {
  frames: Array<{
    title: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  positions: Map<string, { x: number; y: number }>;
}

export function planPileLayout(
  piles: Array<{ title: string; items: LayoutItem[] }>,
  anchor: { x: number; y: number },
): PileLayout {
  const frames: PileLayout["frames"] = [];
  const positions = new Map<string, { x: number; y: number }>();
  let cursorX = anchor.x;
  let cursorY = anchor.y;
  let rowHeight = 0;

  piles.forEach((pile, index) => {
    if (index > 0 && index % FRAMES_PER_ROW === 0) {
      cursorX = anchor.x;
      cursorY += rowHeight + FRAME_GAP;
      rowHeight = 0;
    }

    const columns = Math.min(
      MAX_COLUMNS,
      Math.ceil(Math.sqrt(pile.items.length)),
    );
    const rows = Math.ceil(pile.items.length / columns);
    const cellWidth = Math.max(...pile.items.map((item) => item.width));
    const cellHeight = Math.max(...pile.items.map((item) => item.height));
    const width =
      columns * cellWidth + (columns - 1) * ITEM_GAP + FRAME_PADDING * 2;
    const height =
      FRAME_HEADER + rows * cellHeight + (rows - 1) * ITEM_GAP + FRAME_PADDING;

    pile.items.forEach((item, itemIndex) => {
      const column = itemIndex % columns;
      const row = Math.floor(itemIndex / columns);
      positions.set(item.id, {
        x: cursorX + FRAME_PADDING + column * (cellWidth + ITEM_GAP),
        y: cursorY + FRAME_HEADER + row * (cellHeight + ITEM_GAP),
      });
    });

    frames.push({ title: pile.title, x: cursorX, y: cursorY, width, height });
    cursorX += width + FRAME_GAP;
    rowHeight = Math.max(rowHeight, height);
  });

  return { frames, positions };
}

// ---------------------------------------------------------------------------
// Built-in grouping: no model call, so it is free, private and repeatable.
// Agents with their own model can send smarter piles through piles.propose.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(
  `a about above after again all also am an and any are as at be because been
  before being below between both but by can could did do does doing down during
  each few for from further get got had has have having he her here hers him his
  how i if in into is it its just like me more most my no nor not now of off on
  once only or other our out over own same she should so some such than that the
  their them then there these they this those through to too under until up very
  was we were what when where which while who why will with would you your yours
  new best top guide how-to vs via using use one two three first make way ways
  http https www com org net io html htm php asp index amp utm ref page pages
  article articles post posts blog news watch status item items note notes link
  links untitled`.split(/\s+/),
);

interface GroupingItem {
  id: string;
  type: string;
  content: unknown;
  tags: string[];
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(
      (token) =>
        token.length >= 3 && !/^\d+$/.test(token) && !STOPWORDS.has(token),
    );
}

function getHost(url: string | null) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function toTitle(keyword: string) {
  return keyword.charAt(0).toUpperCase() + keyword.slice(1);
}

/**
 * Greedy keyword cover: repeatedly take the tag or word shared by the most
 * unsorted items, then fall back to grouping links by website. Items that fit
 * nowhere stay where they are.
 */
export function suggestPiles(
  items: GroupingItem[],
  options: { maxPiles?: number } = {},
): PileInput[] {
  const maxPiles = Math.min(options.maxPiles ?? 8, MAX_PILES);
  const keywordsByItem = new Map<string, Set<string>>();
  const tagKeywords = new Set<string>();

  for (const item of items) {
    const keywords = new Set<string>();
    for (const tag of item.tags) {
      const normalized = tag.trim().toLowerCase();
      if (normalized) {
        keywords.add(normalized);
        tagKeywords.add(normalized);
      }
    }
    const url = getItemUrl(item);
    const textWithoutUrl = getItemPlainText(item).replace(url ?? "", " ");
    for (const token of tokenize(textWithoutUrl)) {
      keywords.add(token);
    }
    if (url) {
      try {
        for (const token of tokenize(new URL(url).pathname)) {
          keywords.add(token);
        }
      } catch {
        // Unparseable URLs contribute no path keywords.
      }
    }
    keywordsByItem.set(item.id, keywords);
  }

  const maxShare = Math.max(2, Math.floor(items.length * 0.6));
  const unsorted = new Set(items.map((item) => item.id));
  const piles: PileInput[] = [];

  while (piles.length < maxPiles && unsorted.size >= 2) {
    const counts = new Map<string, number>();
    for (const itemId of unsorted) {
      for (const keyword of keywordsByItem.get(itemId) ?? []) {
        counts.set(keyword, (counts.get(keyword) ?? 0) + 1);
      }
    }

    let best: { keyword: string; count: number } | null = null;
    for (const [keyword, count] of counts) {
      if (count < 2 || (count > maxShare && !tagKeywords.has(keyword))) {
        continue;
      }
      if (
        !best ||
        count > best.count ||
        (count === best.count &&
          (Number(tagKeywords.has(keyword)) -
            Number(tagKeywords.has(best.keyword)) ||
            keyword.length - best.keyword.length ||
            best.keyword.localeCompare(keyword)) > 0)
      ) {
        best = { keyword, count };
      }
    }

    if (!best) break;

    const members = [...unsorted].filter((itemId) =>
      keywordsByItem.get(itemId)?.has(best.keyword),
    );
    members.forEach((itemId) => unsorted.delete(itemId));
    piles.push({ title: toTitle(best.keyword), itemIds: members });
  }

  if (piles.length < maxPiles) {
    const byHost = new Map<string, string[]>();
    for (const item of items) {
      if (!unsorted.has(item.id)) continue;
      const host = getHost(getItemUrl(item));
      if (host) byHost.set(host, [...(byHost.get(host) ?? []), item.id]);
    }
    for (const [host, itemIds] of [...byHost].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
    )) {
      if (itemIds.length < 2 || piles.length >= maxPiles) continue;
      piles.push({ title: host, itemIds });
    }
  }

  return piles;
}

const SORTABLE_TYPES = new Set<string>([
  ItemType.NOTE,
  ItemType.BOOKMARK,
  ItemType.TEXT,
  ItemType.IMAGE,
  ItemType.EMBED,
]);

interface Box {
  positionX: number;
  positionY: number;
  width: number;
  height: number;
}

function isInside(inner: Box, outer: Box) {
  return (
    inner.positionX >= outer.positionX &&
    inner.positionY >= outer.positionY &&
    inner.positionX + inner.width <= outer.positionX + outer.width &&
    inner.positionY + inner.height <= outer.positionY + outer.height
  );
}

/** Loose items on a board: sortable types not already sitting inside a frame. */
export async function listLooseItems(canvasId: string) {
  const items = await prisma.canvasItem.findMany({
    where: { canvasId, deletedAt: null },
    select: {
      id: true,
      type: true,
      content: true,
      tags: true,
      positionX: true,
      positionY: true,
      width: true,
      height: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const frames = items.filter((item) => item.type === ItemType.FRAME);

  return items.filter(
    (item) =>
      SORTABLE_TYPES.has(item.type) &&
      !frames.some((frame) => isInside(item, frame)),
  );
}

// ---------------------------------------------------------------------------
// Proposal, execution and the built-in organizer identity.
// ---------------------------------------------------------------------------

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function assertItemsOnCanvas(canvasId: string, piles: PileInput[]) {
  const itemIds = piles.flatMap((pile) => pile.itemIds);
  const items = await prisma.canvasItem.findMany({
    where: { id: { in: itemIds }, canvasId, deletedAt: null },
    select: { id: true, type: true },
  });

  if (items.length !== itemIds.length) {
    throw new BadRequestError(
      "Some items are not on this board anymore. Refresh and try again.",
    );
  }
  if (items.some((item) => item.type === ItemType.FRAME)) {
    throw new BadRequestError("Frames cannot be put into piles.");
  }
}

export function describePiles(piles: PileInput[]) {
  const total = piles.reduce((sum, pile) => sum + pile.itemIds.length, 0);
  const names = piles.map((pile) => pile.title).join(", ");
  return `Sort ${total} items into ${piles.length} piles: ${names}`.slice(
    0,
    500,
  );
}

export async function proposeCanvasPiles(input: {
  actor: ActorContext;
  canvasId: string;
  piles: unknown;
  summary?: string;
}) {
  const piles = pilesSchema.parse(input.piles);
  await assertItemsOnCanvas(input.canvasId, piles);

  return createSuggestionRecord({
    actor: input.actor,
    kind: SuggestionKind.INTERNAL_ORGANIZATION,
    summary: input.summary?.slice(0, 500) || describePiles(piles),
    payload: {
      kind: PILES_SUGGESTION_KIND,
      canvasId: input.canvasId,
      piles,
    },
    rung: AGENT_CAPABILITY_RUNGS.PROPOSE,
  });
}

/**
 * Creates one frame per pile and moves its items inside, as a single change
 * set. Frames are CREATE records and moves are UPDATE records, so the
 * existing revert path undoes the whole sort in one step.
 */
export async function applyCanvasPiles(input: {
  actor: ActorContext;
  canvasId: string;
  piles: unknown;
  summary?: string;
}) {
  const piles = pilesSchema.parse(input.piles);
  const summary = input.summary?.slice(0, 500) || describePiles(piles);
  const itemIds = piles.flatMap((pile) => pile.itemIds);

  const result = await prisma.$transaction(async (tx) => {
    await lockCanvasForMutation(tx, input.canvasId);
    const canvas = await tx.canvas.findFirst({
      where: { id: input.canvasId, userId: input.actor.userId },
      select: { id: true },
    });
    if (!canvas) {
      throw new NotFoundError("Canvas not found.");
    }

    const canvasItems = await tx.canvasItem.findMany({
      where: { canvasId: input.canvasId, deletedAt: null },
    });
    const byId = new Map(canvasItems.map((item) => [item.id, item]));
    const pileItems = itemIds.map((itemId) => byId.get(itemId));
    if (pileItems.some((item) => !item)) {
      throw new BadRequestError(
        "Some items are not on this board anymore. Refresh and try again.",
      );
    }
    if (pileItems.some((item) => item?.type === ItemType.FRAME)) {
      throw new BadRequestError("Frames cannot be put into piles.");
    }

    await assertCanvasItemCapacity(tx, input.canvasId, piles.length);

    const moving = new Set(itemIds);
    const others = canvasItems.filter((item) => !moving.has(item.id));
    const anchor =
      others.length > 0
        ? {
            x:
              Math.max(...others.map((item) => item.positionX + item.width)) +
              200,
            y: Math.min(...canvasItems.map((item) => item.positionY)),
          }
        : {
            x: Math.min(...canvasItems.map((item) => item.positionX)),
            y: Math.min(...canvasItems.map((item) => item.positionY)),
          };

    const layout = planPileLayout(
      piles.map((pile) => ({
        title: pile.title,
        items: pile.itemIds.map((itemId) => byId.get(itemId)!),
      })),
      anchor,
    );

    const agentAction = await tx.agentAction.create({
      data: {
        userId: input.actor.userId,
        agentProfileId: input.actor.agentProfileId,
        integrationAccountId: input.actor.integrationAccountId ?? null,
        modelCredentialId: input.actor.modelCredentialId ?? null,
        kind: AgentActionKind.WRITE,
        rung: AGENT_CAPABILITY_RUNGS.WRITE_GROUP,
        status: AgentActionStatus.RUNNING,
        summary,
        requestFingerprint: createHash("sha256")
          .update(JSON.stringify({ canvasId: input.canvasId, piles }))
          .digest("hex"),
      },
    });

    const changeSet = await tx.changeSet.create({
      data: {
        userId: input.actor.userId,
        agentProfileId: input.actor.agentProfileId,
        agentActionId: agentAction.id,
        scopeType: "canvas",
        scopeId: input.canvasId,
        status: ChangeSetStatus.RUNNING,
        summary,
      },
    });

    const frames = [];
    for (const frame of layout.frames) {
      const created = await tx.canvasItem.create({
        data: {
          canvasId: input.canvasId,
          type: ItemType.FRAME,
          positionX: frame.x,
          positionY: frame.y,
          width: frame.width,
          height: frame.height,
          zIndex: 0,
          content: toJsonValue({ title: frame.title }),
          tags: [],
          version: 1,
          createdById: input.actor.userId,
          updatedById: input.actor.userId,
        },
      });
      frames.push(created);
      await tx.changeRecord.create({
        data: {
          changeSetId: changeSet.id,
          targetType: "CanvasItem",
          targetId: created.id,
          operation: "CREATE",
          before: Prisma.JsonNull,
          after: toJsonValue(created),
          reversible: true,
        },
      });
    }

    for (const item of pileItems) {
      const position = layout.positions.get(item!.id)!;
      const updated = await tx.canvasItem.update({
        where: { id: item!.id },
        data: {
          positionX: position.x,
          positionY: position.y,
          zIndex: Math.max(item!.zIndex, 1),
          version: { increment: 1 },
          updatedById: input.actor.userId,
        },
      });
      await tx.changeRecord.create({
        data: {
          changeSetId: changeSet.id,
          targetType: "CanvasItem",
          targetId: item!.id,
          operation: "UPDATE",
          before: toJsonValue(item),
          after: toJsonValue(updated),
          reversible: true,
        },
      });
    }

    const completedAt = new Date();
    await tx.changeSet.update({
      where: { id: changeSet.id },
      data: { status: ChangeSetStatus.COMPLETED, completedAt },
    });
    await tx.agentAction.update({
      where: { id: agentAction.id },
      data: { status: AgentActionStatus.COMPLETED },
    });

    return {
      agentActionId: agentAction.id,
      changeSetId: changeSet.id,
      frames: frames.map((frame) => ({
        id: frame.id,
        title: (frame.content as { title?: string }).title ?? "",
      })),
      movedItemCount: pileItems.length,
    };
  });

  await invalidateCanvasCache(input.canvasId);
  return result;
}

/**
 * Runs an approved pile suggestion. Only the user can approve, so the
 * approval is the authority here: the proposing agent needs its propose rung
 * and the board must still be in its scope, but not a direct-write rung.
 */
export async function executePilesSuggestion(input: {
  actor: ActorContext;
  agentProfile: Parameters<typeof assertAgentCapability>[0];
  payload: unknown;
  summary: string;
}) {
  const parsed = pilesSuggestionPayloadSchema.parse(input.payload);
  assertCanvasScope(input.agentProfile, parsed.canvasId);
  assertAgentCapability(input.agentProfile, AGENT_CAPABILITY_RUNGS.PROPOSE);

  return applyCanvasPiles({
    actor: input.actor,
    canvasId: parsed.canvasId,
    piles: parsed.piles,
    summary: input.summary,
  });
}

/**
 * The built-in sorter acts through its own agent profile so its proposals,
 * change sets and undo history look exactly like any other agent's.
 */
export async function getOrganizerProfileForCanvas(
  userId: string,
  canvasId: string,
) {
  const enabledRungs = [
    AGENT_CAPABILITY_RUNGS.READ,
    AGENT_CAPABILITY_RUNGS.PROPOSE,
  ];
  const existing = await prisma.agentProfile.findFirst({
    where: { userId, name: ORGANIZER_PROFILE_NAME },
    orderBy: { createdAt: "asc" },
  });

  if (!existing) {
    return prisma.agentProfile.create({
      data: {
        userId,
        name: ORGANIZER_PROFILE_NAME,
        status: AgentProfileStatus.ACTIVE,
        maxCapabilityRung: AGENT_CAPABILITY_RUNGS.PROPOSE,
        enabledRungs,
        allowedCanvasIds: [canvasId],
      },
    });
  }

  if (existing.allowedCanvasIds.includes(canvasId)) {
    return existing;
  }

  return prisma.agentProfile.update({
    where: { id: existing.id },
    data: { allowedCanvasIds: { push: canvasId } },
  });
}
