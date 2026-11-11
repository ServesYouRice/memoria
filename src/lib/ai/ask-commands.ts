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
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { AGENT_CAPABILITY_RUNGS } from "@/lib/agents/constants";
import { assertAgentCapability } from "@/lib/agents/policy";
import { proposeCanvasPiles } from "@/lib/agents/piles";
import {
  createSuggestionRecord,
  type ActorContext,
} from "@/lib/agents/service-core";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import { recordCanvasItemEvent } from "@/lib/collaboration/committed-events";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import {
  assertCanvasCapacity,
  assertCanvasItemCapacity,
} from "@/lib/policy/capacity";
import { ActivityType, logActivity } from "@/lib/activity";
import { archiveItems } from "@/lib/services/archive";
import { ItemType } from "@/types/canvas";
import {
  askCommandSchema,
  describeAskCommand,
  type AskCommand,
} from "@/lib/ai/ask-schema";

/**
 * IMP-068 — Ask files commands as suggestions; it never writes. These are the
 * proposal and the post-approval execution. Execution re-checks everything
 * against the database at run time, because the user approves later and the
 * items may have moved or gone.
 */

export const ASK_COMMAND_SUGGESTION_KIND = "ask-command";
export const ASK_ASSISTANT_PROFILE_NAME = "Memoria assistant";

/** Change records for a cross-board move; undo puts the item back. */
export const ASK_MOVE_OPERATION = "MOVE";

/**
 * Item types that can change boards. Images keep their upload on the source
 * board and frames hold other items by position, so they stay put.
 */
const MOVABLE_TYPES = new Set<string>([
  ItemType.NOTE,
  ItemType.BOOKMARK,
  ItemType.TEXT,
  ItemType.EMBED,
  ItemType.POLL,
  ItemType.DRAWING,
  ItemType.SHAPE,
]);

export const askCommandSuggestionPayloadSchema = z.object({
  kind: z.literal(ASK_COMMAND_SUGGESTION_KIND),
  command: askCommandSchema,
  question: z.string().max(1_000).optional(),
});

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** The built-in profile Ask proposes through; propose rung only. */
export async function getAskAssistantProfile(userId: string) {
  const existing = await prisma.agentProfile.findFirst({
    where: { userId, name: ASK_ASSISTANT_PROFILE_NAME },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;
  return prisma.agentProfile.create({
    data: {
      userId,
      name: ASK_ASSISTANT_PROFILE_NAME,
      status: AgentProfileStatus.ACTIVE,
      maxCapabilityRung: AGENT_CAPABILITY_RUNGS.PROPOSE,
      enabledRungs: [
        AGENT_CAPABILITY_RUNGS.READ,
        AGENT_CAPABILITY_RUNGS.PROPOSE,
      ],
      allowedCanvasIds: [],
    },
  });
}

async function loadOwnedItems(
  store: Prisma.TransactionClient | typeof prisma,
  userId: string,
  itemIds: string[],
) {
  const items = await store.canvasItem.findMany({
    where: {
      id: { in: itemIds },
      deletedAt: null,
      canvas: { userId, isTemplate: false },
    },
  });
  if (items.length !== new Set(itemIds).size) {
    throw new BadRequestError(
      "Some items are gone or are not yours anymore. Ask again.",
    );
  }
  return items;
}

function assertMovable(items: { type: string }[]) {
  if (items.some((item) => !MOVABLE_TYPES.has(item.type))) {
    throw new BadRequestError(
      "Images and frames stay on their board; leave them out of moves.",
    );
  }
}

/**
 * Files a validated Ask command as a suggestion. Ownership is checked now so
 * the user is never asked to approve something that cannot run.
 */
export async function proposeAskCommand(input: {
  userId: string;
  command: AskCommand;
  question: string;
}) {
  const command = askCommandSchema.parse(input.command);
  const profile = await getAskAssistantProfile(input.userId);
  assertAgentCapability(profile, AGENT_CAPABILITY_RUNGS.PROPOSE);
  const actor: ActorContext = {
    userId: input.userId,
    agentProfileId: profile.id,
    modelCredentialId: profile.defaultModelCredentialId,
  };
  const items = command.itemIds.length
    ? await loadOwnedItems(prisma, input.userId, command.itemIds)
    : [];

  if (command.type === "make_pile") {
    const canvasIds = new Set(items.map((item) => item.canvasId));
    if (canvasIds.size !== 1) {
      throw new BadRequestError("A pile can only hold items from one board.");
    }
    const canvasId = items[0]!.canvasId;
    if (!profile.allowedCanvasIds.includes(canvasId)) {
      // The piles executor checks the proposer's board scope at run time.
      await prisma.agentProfile.update({
        where: { id: profile.id },
        data: { allowedCanvasIds: { push: canvasId } },
      });
    }
    const { suggestion } = await proposeCanvasPiles({
      actor,
      canvasId,
      piles: [{ title: command.title, itemIds: command.itemIds }],
      summary: describeAskCommand(command),
    });
    return suggestion;
  }

  assertMovable(items);

  let boardName: string | undefined;
  if (command.type === "move_items") {
    const board = await prisma.canvas.findFirst({
      where: { id: command.boardId, userId: input.userId, isTemplate: false },
      select: { name: true },
    });
    if (!board) throw new NotFoundError("Board not found.");
    boardName = board.name;
  }

  const { suggestion } = await createSuggestionRecord({
    actor,
    kind: SuggestionKind.INTERNAL_ORGANIZATION,
    summary: describeAskCommand(command, boardName).slice(0, 500),
    payload: {
      kind: ASK_COMMAND_SUGGESTION_KIND,
      command,
      question: input.question.slice(0, 1_000),
    },
    rung: AGENT_CAPABILITY_RUNGS.PROPOSE,
  });
  return suggestion;
}

const GRID_GAP = 40;
const GRID_COLUMNS = 4;

/** Places moved items in a grid to the right of what the board already holds. */
export function planMovePositions(
  existing: { positionX: number; positionY: number; width: number }[],
  moving: { id: string; width: number; height: number }[],
) {
  const originX =
    existing.length > 0
      ? Math.max(...existing.map((item) => item.positionX + item.width)) + 200
      : 100;
  const originY =
    existing.length > 0
      ? Math.min(...existing.map((item) => item.positionY))
      : 100;
  const cellWidth =
    Math.max(200, ...moving.map((item) => item.width)) + GRID_GAP;
  const positions = new Map<string, { x: number; y: number }>();
  let rowY = originY;
  for (let row = 0; row * GRID_COLUMNS < moving.length; row += 1) {
    const slice = moving.slice(row * GRID_COLUMNS, (row + 1) * GRID_COLUMNS);
    slice.forEach((item, column) => {
      positions.set(item.id, { x: originX + column * cellWidth, y: rowY });
    });
    rowY += Math.max(...slice.map((item) => item.height)) + GRID_GAP;
  }
  return positions;
}

async function createBoardTx(
  tx: Prisma.TransactionClient,
  userId: string,
  changeSetId: string,
  name: string,
) {
  await assertCanvasCapacity(tx, userId);
  const board = await tx.canvas.create({
    data: { name, userId },
    select: { id: true, name: true, createdAt: true, updatedAt: true },
  });
  await tx.changeRecord.create({
    data: {
      // Undo walks records newest first and removes a board only once it is
      // empty, so the board record must sort before the moves onto it.
      createdAt: new Date(Date.now() - 1_000),
      changeSetId,
      targetType: "Canvas",
      targetId: board.id,
      operation: "CREATE",
      before: Prisma.JsonNull,
      after: toJsonValue(board),
      reversible: true,
    },
  });
  return board;
}

/**
 * Runs an approved Ask command as one change set. Moves keep the item (and
 * its comments, links and embeddings) and only change its board, recorded as
 * `MOVE` so undo returns it. Its connector lines on the old board are deleted
 * and recorded as `ItemConnection:DELETE`, so undo restores them too.
 */
export async function executeAskCommandSuggestion(input: {
  actor: ActorContext;
  agentProfile: Parameters<typeof assertAgentCapability>[0];
  payload: unknown;
  summary: string;
  /**
   * When set, every item must still be on this board once the boards are
   * locked; a home-board filing never moves an item the user moved since.
   */
  expectedSourceCanvasId?: string;
}) {
  const { command } = askCommandSuggestionPayloadSchema.parse(input.payload);
  assertAgentCapability(input.agentProfile, AGENT_CAPABILITY_RUNGS.PROPOSE);
  if (command.type === "make_pile") {
    throw new BadRequestError("Piles run through the piles executor.");
  }
  if (command.type === "archive") {
    // IMP-070: one archive concept. Archived items go to the trash-backed
    // archive (kept until restored) in one change set that undo reverses.
    return archiveItems({
      actor: input.actor,
      itemIds: command.itemIds,
      summary: input.summary,
    });
  }
  const userId = input.actor.userId;
  const touched = new Set<string>();

  const result = await prisma.$transaction(async (tx) => {
    const agentAction = await tx.agentAction.create({
      data: {
        userId,
        agentProfileId: input.actor.agentProfileId,
        integrationAccountId: input.actor.integrationAccountId ?? null,
        modelCredentialId: input.actor.modelCredentialId ?? null,
        kind: AgentActionKind.WRITE,
        rung: AGENT_CAPABILITY_RUNGS.WRITE_GROUP,
        status: AgentActionStatus.RUNNING,
        summary: input.summary,
        requestFingerprint: createHash("sha256")
          .update(JSON.stringify({ askCommand: command }))
          .digest("hex"),
      },
    });

    let target: { id: string; name: string } | null = null;
    let createdBoardId: string | null = null;
    if (command.type === "move_items") {
      target = await tx.canvas.findFirst({
        where: { id: command.boardId, userId, isTemplate: false },
        select: { id: true, name: true },
      });
      if (!target) throw new NotFoundError("Board not found.");
    }

    const changeSet = await tx.changeSet.create({
      data: {
        userId,
        agentProfileId: input.actor.agentProfileId,
        agentActionId: agentAction.id,
        scopeType: "user",
        scopeId: userId,
        status: ChangeSetStatus.RUNNING,
        summary: input.summary,
      },
    });

    if (command.type === "create_board") {
      target = await createBoardTx(tx, userId, changeSet.id, command.name);
      createdBoardId = target.id;
    }

    if (!target) throw new NotFoundError("Board not found.");

    // This first read only picks the boards to lock; everything the move
    // writes comes from the second read, made while those locks are held.
    const unlocked = command.itemIds.length
      ? await loadOwnedItems(tx, userId, command.itemIds)
      : [];
    assertMovable(unlocked);
    const lockSet = unlocked.filter((item) => item.canvasId !== target!.id);
    let items = unlocked;

    if (lockSet.length > 0) {
      // One lock order for every board involved, so concurrent moves cannot deadlock.
      const canvasIds = Array.from(
        new Set([target.id, ...lockSet.map((item) => item.canvasId)]),
      ).sort();
      for (const canvasId of canvasIds) {
        await lockCanvasForMutation(tx, canvasId);
        touched.add(canvasId);
      }
      items = await loadOwnedItems(tx, userId, command.itemIds);
      const lockedFrom = new Map(
        unlocked.map((item) => [item.id, item.canvasId]),
      );
      if (items.some((item) => lockedFrom.get(item.id) !== item.canvasId)) {
        throw new ConflictError("Items moved while filing; try again.");
      }
    }
    if (
      input.expectedSourceCanvasId !== undefined &&
      items.some((item) => item.canvasId !== input.expectedSourceCanvasId)
    ) {
      throw new BadRequestError(
        "This item has already moved, so the suggestion was dropped.",
      );
    }
    const moving = items.filter((item) => item.canvasId !== target!.id);

    if (moving.length > 0) {
      await assertCanvasItemCapacity(tx, target.id, moving.length);

      const existing = await tx.canvasItem.findMany({
        where: { canvasId: target.id, deletedAt: null },
        select: { positionX: true, positionY: true, width: true },
      });
      const positions = planMovePositions(existing, moving);
      // IMP-072: undo walks records newest first, so the dropped lines must
      // sort before every move and are restored once all items are back.
      const droppedConnectionsAt = new Date(Date.now() - 1);

      for (const item of moving) {
        const position = positions.get(item.id)!;
        // Lines cannot cross boards, so the item's connections on the old
        // board (both directions) go with the move and come back on undo.
        const connections = await tx.itemConnection.findMany({
          where: { OR: [{ fromId: item.id }, { toId: item.id }] },
        });
        if (connections.length > 0) {
          await tx.itemConnection.deleteMany({
            where: {
              id: { in: connections.map((connection) => connection.id) },
            },
          });
          await tx.changeRecord.createMany({
            data: connections.map((connection) => ({
              createdAt: droppedConnectionsAt,
              changeSetId: changeSet.id,
              targetType: "ItemConnection",
              targetId: connection.id,
              operation: "DELETE",
              before: toJsonValue(connection),
              after: Prisma.JsonNull,
              reversible: true,
            })),
          });
        }
        // Only while the item is still where the locked read found it.
        const updated = await tx.canvasItem
          .update({
            where: { id: item.id, canvasId: item.canvasId, deletedAt: null },
            data: {
              canvasId: target.id,
              positionX: position.x,
              positionY: position.y,
              version: { increment: 1 },
              updatedById: userId,
            },
          })
          .catch((error: unknown) => {
            if (
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === "P2025"
            ) {
              throw new ConflictError("Items moved while filing; try again.");
            }
            throw error;
          });
        await recordCanvasItemEvent(tx, {
          canvasId: item.canvasId,
          actorId: userId,
          itemId: item.id,
          version: updated.version,
          operation: "deleted",
        });
        await recordCanvasItemEvent(tx, {
          canvasId: target.id,
          actorId: userId,
          itemId: item.id,
          version: updated.version,
          operation: "created",
        });
        await tx.changeRecord.create({
          data: {
            createdAt: new Date(),
            changeSetId: changeSet.id,
            targetType: "CanvasItem",
            targetId: item.id,
            operation: ASK_MOVE_OPERATION,
            before: toJsonValue(item),
            after: toJsonValue(updated),
            reversible: true,
          },
        });
      }
    }

    await tx.changeSet.update({
      where: { id: changeSet.id },
      data: { status: ChangeSetStatus.COMPLETED, completedAt: new Date() },
    });
    await tx.agentAction.update({
      where: { id: agentAction.id },
      data: { status: AgentActionStatus.COMPLETED },
    });

    return {
      agentActionId: agentAction.id,
      changeSetId: changeSet.id,
      boardId: target.id,
      boardName: target.name,
      createdBoard: createdBoardId !== null,
      movedItemCount: moving.length,
    };
  });

  await Promise.all(
    Array.from(touched).map((canvasId) => invalidateCanvasCache(canvasId)),
  );
  if (result.createdBoard) {
    await logActivity({
      userId,
      type: ActivityType.CANVAS_CREATED,
      canvasId: result.boardId,
      canvasName: result.boardName,
    });
  }
  return result;
}
