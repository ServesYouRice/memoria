import { AgentActionKind } from "@/generated/prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { AGENT_CAPABILITY_RUNGS } from "@/lib/agents/constants";
import { assertAgentCapability, assertCanvasScope } from "@/lib/agents/policy";
import {
  createCanvasItemWrite,
  type ActorContext,
} from "@/lib/agents/service-core";
import { parseCanvasItemContent } from "@/lib/validation/canvas-item";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import { ItemType } from "@/types/canvas";

export const INBOX_CANVAS_NAME = "Inbox";

const SLOT_ORIGIN = 80;
const SLOT_WIDTH = 400;
const SLOT_HEIGHT = 260;
const SLOT_COLUMNS = 6;
const MAX_SLOT_SEARCH = 5000;

interface Rect {
  positionX: number;
  positionY: number;
  width: number;
  height: number;
}

function overlaps(a: Rect, b: Rect) {
  return (
    a.positionX < b.positionX + b.width &&
    b.positionX < a.positionX + a.width &&
    a.positionY < b.positionY + b.height &&
    b.positionY < a.positionY + a.height
  );
}

/** First grid cell that no existing item covers, so saves never stack. */
export function findOpenSlot(
  occupied: Rect[],
  size: { width: number; height: number },
) {
  for (let index = 0; index < MAX_SLOT_SEARCH; index += 1) {
    const candidate = {
      positionX: SLOT_ORIGIN + (index % SLOT_COLUMNS) * SLOT_WIDTH,
      positionY: SLOT_ORIGIN + Math.floor(index / SLOT_COLUMNS) * SLOT_HEIGHT,
      ...size,
    };
    if (!occupied.some((rect) => overlaps(rect, candidate))) {
      return { x: candidate.positionX, y: candidate.positionY };
    }
  }

  return {
    x: SLOT_ORIGIN,
    y: SLOT_ORIGIN + Math.ceil(MAX_SLOT_SEARCH / SLOT_COLUMNS) * SLOT_HEIGHT,
  };
}

export const inboxSaveSchema = z
  .object({
    url: z.string().trim().max(2048).optional(),
    text: z.string().trim().max(20_000).optional(),
    title: z.string().trim().max(500).optional(),
    description: z.string().trim().max(2000).optional(),
    tags: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
  })
  .refine((value) => Boolean(value.url || value.text), {
    message: "Send a url to save a link, or text to save a note.",
  });

export async function saveToInbox(input: {
  actor: ActorContext;
  agentProfile: NonNullable<Parameters<typeof assertAgentCapability>[0]>;
  data: unknown;
}) {
  const data = inboxSaveSchema.parse(input.data);
  assertAgentCapability(input.agentProfile, AGENT_CAPABILITY_RUNGS.INGEST);

  const inbox = await prisma.canvas.findFirst({
    where: {
      userId: input.actor.userId,
      name: INBOX_CANVAS_NAME,
      ...(input.agentProfile.allowedCanvasIds.length > 0
        ? { id: { in: input.agentProfile.allowedCanvasIds } }
        : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!inbox) {
    throw new NotFoundError(
      "No Inbox board is shared with this app. Allow it the Inbox board in Memoria.",
    );
  }
  assertCanvasScope(input.agentProfile, inbox.id);

  const isLink = Boolean(data.url);
  const type = isLink ? ItemType.BOOKMARK : ItemType.NOTE;
  const size = isLink
    ? { width: 360, height: 120 }
    : { width: 320, height: 220 };
  const content = parseCanvasItemContent(
    type,
    isLink
      ? {
          url: data.url,
          title: data.title || data.url,
          description: data.description || data.text?.slice(0, 2000),
        }
      : { text: data.title ? `${data.title}\n\n${data.text}` : data.text },
  );

  const occupied = await prisma.canvasItem.findMany({
    where: { canvasId: inbox.id, deletedAt: null },
    select: { positionX: true, positionY: true, width: true, height: true },
  });
  const slot = findOpenSlot(occupied, size);

  const result = await createCanvasItemWrite({
    actor: input.actor,
    canvasId: inbox.id,
    itemData: {
      type,
      positionX: slot.x,
      positionY: slot.y,
      ...size,
      zIndex: 1,
      content,
      tags: data.tags,
    },
    summary: isLink ? `Save link to Inbox` : `Save note to Inbox`,
    rung: AGENT_CAPABILITY_RUNGS.INGEST,
    actionKind: AgentActionKind.INGEST,
  });

  await invalidateCanvasCache(inbox.id);
  return {
    canvasId: inbox.id,
    itemId: result.item.id,
    changeSetId: result.changeSetId,
  };
}
