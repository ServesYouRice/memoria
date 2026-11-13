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
import { enqueueLinkEnrichment } from "@/lib/services/link-enrichment";
import {
  existingFor,
  findExistingLinks,
  normalizeLinkUrl,
} from "@/lib/services/duplicates";
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

/**
 * First grid cell that no existing item covers, so saves never stack. A bulk
 * save passes the `index` of the slot it last filled as `startIndex`, so
 * placing many links does not search from the first cell every time.
 */
export function findOpenSlot(
  occupied: Rect[],
  size: { width: number; height: number },
  startIndex = 0,
) {
  for (let index = startIndex; index < MAX_SLOT_SEARCH; index += 1) {
    const candidate = {
      positionX: SLOT_ORIGIN + (index % SLOT_COLUMNS) * SLOT_WIDTH,
      positionY: SLOT_ORIGIN + Math.floor(index / SLOT_COLUMNS) * SLOT_HEIGHT,
      ...size,
    };
    if (!occupied.some((rect) => overlaps(rect, candidate))) {
      return { x: candidate.positionX, y: candidate.positionY, index };
    }
  }

  return {
    x: SLOT_ORIGIN,
    y: SLOT_ORIGIN + Math.ceil(MAX_SLOT_SEARCH / SLOT_COLUMNS) * SLOT_HEIGHT,
    index: MAX_SLOT_SEARCH,
  };
}

export const inboxSaveSchema = z
  .object({
    url: z.string().trim().max(2048).optional(),
    text: z.string().trim().max(20_000).optional(),
    title: z.string().trim().max(500).optional(),
    description: z.string().trim().max(2000).optional(),
    tags: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
    /** Save onto this board instead of the Inbox; it must be in scope. */
    canvasId: z.string().trim().min(1).max(64).optional(),
    /** Save the link again even when it is already saved (IMP-065). */
    allowDuplicate: z.boolean().optional(),
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

  const inbox = data.canvasId
    ? await prisma.canvas.findFirst({
        where: { id: data.canvasId, userId: input.actor.userId },
        select: { id: true, name: true },
      })
    : await prisma.canvas.findFirst({
        where: {
          userId: input.actor.userId,
          name: INBOX_CANVAS_NAME,
          ...(input.agentProfile.allowedCanvasIds.length > 0
            ? { id: { in: input.agentProfile.allowedCanvasIds } }
            : {}),
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true },
      });

  if (!inbox) {
    throw new NotFoundError(
      data.canvasId
        ? "Canvas not found."
        : "No Inbox canvas is shared with this app. Allow it the Inbox canvas in Memoria.",
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

  // "You saved this already" (IMP-065): name the existing copy instead of
  // saving the link twice. Only boards this app may see are considered, so
  // the answer never reveals items outside its scope.
  const linkUrl = isLink ? (content as { url: string }).url : null;
  const duplicates = linkUrl
    ? existingFor(
        await findExistingLinks(prisma, input.actor.userId, [linkUrl]),
        linkUrl,
      ).filter(
        (entry) =>
          input.agentProfile.allowedCanvasIds.length === 0 ||
          input.agentProfile.allowedCanvasIds.includes(entry.canvasId),
      )
    : [];
  if (duplicates.length > 0 && !data.allowDuplicate) {
    const [first] = duplicates;
    return {
      saved: false,
      duplicate: true,
      canvasId: first!.canvasId,
      itemId: first!.itemId,
      existing: duplicates.map((entry) => ({
        itemId: entry.itemId,
        canvasId: entry.canvasId,
        board: entry.canvasName,
        title: entry.title,
        url: entry.url,
      })),
      message: `Already saved as "${first!.title || first!.url}" on ${first!.canvasName}. Pass allowDuplicate: true to save it again.`,
    };
  }

  const result = await createCanvasItemWrite({
    actor: input.actor,
    canvasId: inbox.id,
    itemData: {
      type,
      // Placeholders: the slot is chosen under the canvas lock below.
      positionX: 0,
      positionY: 0,
      ...size,
      zIndex: 1,
      content,
      tags: data.tags,
    },
    summary: `Save ${isLink ? "link" : "note"} to ${inbox.name}`,
    rung: AGENT_CAPABILITY_RUNGS.INGEST,
    actionKind: AgentActionKind.INGEST,
    // Read occupancy after the lock, so concurrent saves see each other and
    // never pick the same slot.
    resolvePlacement: async (tx) => {
      const occupied = await tx.canvasItem.findMany({
        where: { canvasId: inbox.id, deletedAt: null },
        select: { positionX: true, positionY: true, width: true, height: true },
      });
      const slot = findOpenSlot(occupied, size);
      return { positionX: slot.x, positionY: slot.y };
    },
    // Saved links name, tag and summarize themselves (IMP-064); a title the
    // agent chose is kept.
    afterCreate: isLink
      ? async (tx, item) => {
          await tx.canvasItem.update({
            where: { id: item.id },
            data: { normalizedUrl: normalizeLinkUrl(linkUrl!) },
          });
          await enqueueLinkEnrichment(tx, input.actor.userId, [
            {
              itemId: item.id,
              baseTitle: data.title || data.url,
              baseTags: data.tags,
              titleLocked: Boolean(data.title),
            },
          ]);
        }
      : undefined,
  });

  await invalidateCanvasCache(inbox.id);
  return {
    saved: true,
    canvasId: inbox.id,
    itemId: result.item.id,
    changeSetId: result.changeSetId,
    ...(duplicates.length > 0
      ? {
          duplicate: true,
          existing: duplicates.map((entry) => ({
            itemId: entry.itemId,
            canvasId: entry.canvasId,
            board: entry.canvasName,
            title: entry.title,
            url: entry.url,
          })),
        }
      : {}),
  };
}
