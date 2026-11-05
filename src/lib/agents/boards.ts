import {
  AgentActionKind,
  AgentActionStatus,
  ChangeSetStatus,
  Prisma,
} from "@/generated/prisma/client";
import { createHash } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ActivityType, logActivity } from "@/lib/activity";
import { AGENT_CAPABILITY_RUNGS } from "@/lib/agents/constants";
import { assertAgentCapability } from "@/lib/agents/policy";
import type { ActorContext } from "@/lib/agents/service-core";
import { assertCanvasCapacity } from "@/lib/policy/capacity";

type ScopedAgentProfile = NonNullable<
  Parameters<typeof assertAgentCapability>[0]
> & {
  id: string;
};

/** Change records for a board the agent made carry who was granted it. */
export const AGENT_BOARD_TARGET_TYPE = "Canvas";

export const boardCreateSchema = z.object({
  name: z.string().trim().min(1).max(255),
});

export const boardListSchema = z.object({
  query: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const boardSelect = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CanvasSelect;

async function findScopedBoardByName(
  store: Prisma.TransactionClient | typeof prisma,
  userId: string,
  allowedCanvasIds: string[],
  name: string,
) {
  return store.canvas.findFirst({
    where: {
      userId,
      isTemplate: false,
      id: { in: allowedCanvasIds },
      name: { equals: name, mode: "insensitive" },
    },
    orderBy: { createdAt: "asc" },
    select: boardSelect,
  });
}

/**
 * Boards the agent may read, slim enough to pick one by name. `itemCount`
 * counts live items so an agent can tell an empty board from a used one.
 */
export async function listAgentBoards(input: {
  userId: string;
  agentProfile: Pick<ScopedAgentProfile, "allowedCanvasIds"> | null;
  data: unknown;
}) {
  const data = boardListSchema.parse(input.data ?? {});
  const boards = await prisma.canvas.findMany({
    where: {
      userId: input.userId,
      isTemplate: false,
      ...(input.agentProfile
        ? { id: { in: input.agentProfile.allowedCanvasIds } }
        : {}),
      ...(data.query
        ? { name: { contains: data.query, mode: "insensitive" as const } }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: data.limit,
    select: {
      ...boardSelect,
      _count: { select: { items: { where: { deletedAt: null } } } },
    },
  });

  return {
    boards: boards.map(({ _count, ...board }) => ({
      boardId: board.id,
      ...board,
      itemCount: _count.items,
    })),
  };
}

/**
 * Create a board for an agent, or return the agent's board that already has
 * this name, so errands and retries reuse one board. A new board is added to
 * the agent's canvas scope and recorded as a revertible change set; undoing
 * it removes the board only while it is empty.
 */
export async function createAgentBoard(input: {
  actor: ActorContext;
  agentProfile: ScopedAgentProfile;
  data: unknown;
}) {
  const { name } = boardCreateSchema.parse(input.data);
  assertAgentCapability(input.agentProfile, AGENT_CAPABILITY_RUNGS.INGEST);

  const result = await prisma.$transaction(async (tx) => {
    const reusable = await findScopedBoardByName(
      tx,
      input.actor.userId,
      input.agentProfile.allowedCanvasIds,
      name,
    );
    if (reusable) {
      return { board: reusable, created: false as const };
    }
    // The capacity check takes the per-user canvas lock. Looking again after
    // it, with the scope as stored now, means two concurrent calls with one
    // name still make one board.
    await assertCanvasCapacity(tx, input.actor.userId);
    const storedScope = await tx.agentProfile.findUniqueOrThrow({
      where: { id: input.agentProfile.id },
      select: { allowedCanvasIds: true },
    });
    const existing = await findScopedBoardByName(
      tx,
      input.actor.userId,
      storedScope.allowedCanvasIds,
      name,
    );
    if (existing) {
      return { board: existing, created: false as const };
    }

    const summary = `Create board ${name}`;
    const agentAction = await tx.agentAction.create({
      data: {
        userId: input.actor.userId,
        agentProfileId: input.actor.agentProfileId,
        integrationAccountId: input.actor.integrationAccountId ?? null,
        modelCredentialId: input.actor.modelCredentialId ?? null,
        kind: AgentActionKind.INGEST,
        rung: AGENT_CAPABILITY_RUNGS.INGEST,
        status: AgentActionStatus.RUNNING,
        summary,
        requestFingerprint: createHash("sha256")
          .update(JSON.stringify({ boardCreate: name }))
          .digest("hex"),
      },
    });

    const board = await tx.canvas.create({
      data: { name, userId: input.actor.userId },
      select: boardSelect,
    });

    // The new board joins the agent's scope so it can save into it.
    await tx.agentProfile.update({
      where: { id: input.agentProfile.id },
      data: { allowedCanvasIds: { push: board.id } },
    });

    const changeSet = await tx.changeSet.create({
      data: {
        userId: input.actor.userId,
        agentProfileId: input.actor.agentProfileId,
        agentActionId: agentAction.id,
        scopeType: "canvas",
        scopeId: board.id,
        status: ChangeSetStatus.RUNNING,
        summary,
      },
    });

    await tx.changeRecord.create({
      data: {
        changeSetId: changeSet.id,
        targetType: AGENT_BOARD_TARGET_TYPE,
        targetId: board.id,
        operation: "CREATE",
        before: Prisma.JsonNull,
        after: JSON.parse(
          JSON.stringify({
            ...board,
            grantedAgentProfileId: input.agentProfile.id,
          }),
        ) as Prisma.InputJsonValue,
        reversible: true,
      },
    });

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
      board,
      created: true as const,
      agentActionId: agentAction.id,
      changeSetId: changeSet.id,
    };
  });

  if (result.created) {
    await logActivity({
      userId: input.actor.userId,
      type: ActivityType.CANVAS_CREATED,
      canvasId: result.board.id,
      canvasName: result.board.name,
    });
  }

  return {
    boardId: result.board.id,
    canvasId: result.board.id,
    name: result.board.name,
    created: result.created,
    ...(result.created
      ? {
          agentActionId: result.agentActionId,
          changeSetId: result.changeSetId,
        }
      : {}),
  };
}
