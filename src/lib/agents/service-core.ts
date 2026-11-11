import { createHash } from "crypto";
import {
  AgentActionKind,
  AgentActionStatus,
  ChangeSetStatus,
  ItemEntityLinkType,
  Prisma,
  SuggestionStatus,
  WorkspaceCheckpointActorType,
  type CanvasItem as PrismaCanvasItem,
  type SuggestionKind,
} from "@/generated/prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { BadRequestError, ForbiddenError, NotFoundError } from "@/lib/errors";
import {
  DEFAULT_SUGGESTION_TTL_DAYS,
  AGENT_CAPABILITY_RUNGS,
} from "@/lib/agents/constants";
import { sanitizeComment } from "@/lib/sanitization";
import { parseCanvasItemContent } from "@/lib/validation/canvas-item";
import { ItemType } from "@/types/canvas";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import {
  recordCanvasItemEvent,
  recordCanvasItemEventsBatch,
} from "@/lib/collaboration/committed-events";
import { assertCanvasItemCapacity } from "@/lib/policy/capacity";
import { ARCHIVE_OPERATION, revertArchivedItem } from "@/lib/services/archive";
import { assertCanvasScope } from "@/lib/agents/policy";
import { requirePollsEnabled } from "@/lib/polls/availability";

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function buildRequestFingerprint(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

const agentItemSchema = z.object({
  type: z.nativeEnum(ItemType),
  positionX: z.number().finite(),
  positionY: z.number().finite(),
  width: z.number().positive().finite(),
  height: z.number().positive().finite(),
  zIndex: z.number().int().min(0),
  content: z.unknown(),
  tags: z.array(z.string().min(1).max(64)).default([]),
});

export interface ActorContext {
  userId: string;
  agentProfileId: string;
  integrationAccountId?: string | null;
  modelCredentialId?: string | null;
}

export interface AgentItemWriteData {
  type: ItemType;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  zIndex: number;
  content: unknown;
  tags: string[];
}

export function normalizeAgentItemWriteData(
  input: unknown,
): AgentItemWriteData {
  const parsed = agentItemSchema.parse(input);
  // Agent writes honor the same launch gate as the REST item routes.
  requirePollsEnabled(parsed.type);

  return {
    ...parsed,
    content: parseCanvasItemContent(parsed.type, parsed.content),
  };
}

export function normalizeAgentItemWriteBatch(
  inputs: unknown[],
): AgentItemWriteData[] {
  return inputs.map((input) => normalizeAgentItemWriteData(input));
}

async function getOwnedCanvasTx(
  tx: Prisma.TransactionClient,
  userId: string,
  canvasId: string,
) {
  const canvas = await tx.canvas.findFirst({
    where: {
      id: canvasId,
      userId,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!canvas) {
    throw new NotFoundError("Canvas not found.");
  }

  return canvas;
}

async function getCanvasItemScopeTx(
  tx: Prisma.TransactionClient,
  userId: string,
  itemId: string,
) {
  const item = await tx.canvasItem.findFirst({
    where: {
      id: itemId,
      deletedAt: null,
      canvas: {
        userId,
      },
    },
    select: {
      id: true,
      canvasId: true,
    },
  });

  if (!item) {
    throw new NotFoundError("Canvas item not found.");
  }

  return item;
}

async function getKnowledgeEntityScopeTx(
  tx: Prisma.TransactionClient,
  userId: string,
  entityId: string,
) {
  const entity = await tx.knowledgeEntity.findFirst({
    where: {
      id: entityId,
      userId,
    },
    select: {
      id: true,
      title: true,
      entityType: true,
      itemLinks: {
        select: {
          item: {
            select: {
              canvasId: true,
            },
          },
        },
      },
    },
  });

  if (!entity) {
    throw new NotFoundError("Knowledge entity not found.");
  }

  const canvasIds = Array.from(
    new Set(entity.itemLinks.map((link) => link.item.canvasId)),
  );

  if (canvasIds.length === 0) {
    throw new BadRequestError(
      "Knowledge entity has no source item scope and cannot be mutated.",
    );
  }

  return {
    ...entity,
    canvasIds,
  };
}

function getSharedCanvasId(
  sourceCanvasIds: string[],
  targetCanvasIds: string[],
): string {
  const targetCanvasSet = new Set(targetCanvasIds);
  const sharedCanvasId = sourceCanvasIds.find((canvasId) =>
    targetCanvasSet.has(canvasId),
  );

  if (!sharedCanvasId) {
    throw new BadRequestError(
      "Knowledge relations must stay within one shared canvas scope.",
    );
  }

  return sharedCanvasId;
}

/** Files a suggestion inside the caller's transaction (IMP-066 home boards). */
export async function createSuggestionRecordTx(
  tx: Prisma.TransactionClient,
  input: {
    actor: ActorContext;
    kind: SuggestionKind;
    summary: string;
    payload: unknown;
    rung: number;
    expiresAt?: Date;
  },
) {
  const expiresAt =
    input.expiresAt ||
    new Date(Date.now() + DEFAULT_SUGGESTION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const suggestion = await tx.suggestion.create({
    data: {
      userId: input.actor.userId,
      agentProfileId: input.actor.agentProfileId,
      kind: input.kind,
      status: SuggestionStatus.OPEN,
      summary: input.summary,
      payload: toJsonValue(input.payload),
      expiresAt,
    },
  });

  const agentAction = await tx.agentAction.create({
    data: {
      userId: input.actor.userId,
      agentProfileId: input.actor.agentProfileId,
      integrationAccountId: input.actor.integrationAccountId ?? null,
      modelCredentialId: input.actor.modelCredentialId ?? null,
      kind: AgentActionKind.PROPOSE,
      rung: input.rung,
      status: AgentActionStatus.APPROVAL_REQUIRED,
      summary: input.summary,
      requestFingerprint: buildRequestFingerprint({
        summary: input.summary,
        payload: input.payload,
        kind: input.kind,
      }),
      metadata: toJsonValue({
        suggestionId: suggestion.id,
        payload: input.payload,
      }),
    },
  });

  return {
    agentAction,
    suggestion,
  };
}

async function completeChangeSetTx(
  tx: Prisma.TransactionClient,
  input: {
    agentActionId: string;
    changeSetId: string;
  },
) {
  const completedAt = new Date();

  await tx.changeSet.update({
    where: { id: input.changeSetId },
    data: {
      status: ChangeSetStatus.COMPLETED,
      completedAt,
    },
  });

  await tx.agentAction.update({
    where: { id: input.agentActionId },
    data: {
      status: AgentActionStatus.COMPLETED,
    },
  });
}

async function createCanvasCheckpointTx(
  tx: Prisma.TransactionClient,
  input: {
    actor: ActorContext;
    canvasId: string;
    reason: string;
  },
) {
  await getOwnedCanvasTx(tx, input.actor.userId, input.canvasId);

  const canvas = await tx.canvas.findFirst({
    where: {
      id: input.canvasId,
      userId: input.actor.userId,
    },
    select: {
      id: true,
      name: true,
      updatedAt: true,
      items: {
        where: {
          deletedAt: null,
        },
        orderBy: [{ zIndex: "asc" }, { createdAt: "asc" }],
        include: {
          comments: {
            where: {
              deletedAt: null,
            },
            orderBy: {
              createdAt: "asc",
            },
          },
        },
      },
    },
  });

  if (!canvas) {
    throw new NotFoundError("Canvas not found.");
  }

  const knowledgeEntities = await tx.knowledgeEntity.findMany({
    where: {
      userId: input.actor.userId,
      itemLinks: {
        some: {
          item: {
            canvasId: input.canvasId,
          },
        },
      },
    },
    include: {
      itemLinks: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  const snapshot = {
    canvas,
    knowledgeEntities,
  };

  return tx.workspaceCheckpoint.create({
    data: {
      userId: input.actor.userId,
      scopeType: "canvas",
      scopeId: input.canvasId,
      snapshot: toJsonValue(snapshot),
      reason: input.reason,
      createdByActorType: WorkspaceCheckpointActorType.AGENT,
      createdByActorId: input.actor.agentProfileId,
    },
  });
}

export async function createSuggestionRecord(input: {
  actor: ActorContext;
  kind: SuggestionKind;
  summary: string;
  payload: unknown;
  rung: number;
  expiresAt?: Date;
}) {
  return prisma.$transaction(async (tx) => createSuggestionRecordTx(tx, input));
}

export async function createWorkspaceCheckpoint(input: {
  actor: ActorContext;
  canvasId: string;
  reason: string;
}) {
  return prisma.$transaction(async (tx) => createCanvasCheckpointTx(tx, input));
}

export async function createBulkCanvasItemSuggestion(input: {
  actor: ActorContext;
  canvasId: string;
  items: unknown[];
  summary: string;
  checkpointReason?: string;
}) {
  const normalizedItems = normalizeAgentItemWriteBatch(input.items);

  return prisma.$transaction(async (tx) => {
    const checkpoint = await createCanvasCheckpointTx(tx, {
      actor: input.actor,
      canvasId: input.canvasId,
      reason: input.checkpointReason || input.summary,
    });

    const suggestionRecord = await createSuggestionRecordTx(tx, {
      actor: input.actor,
      kind: "INTERNAL_ORGANIZATION",
      summary: input.summary,
      payload: {
        kind: "canvas-item-batch-create",
        canvasId: input.canvasId,
        items: normalizedItems,
        executionMode: "bulk",
        checkpointId: checkpoint.id,
      },
      rung: AGENT_CAPABILITY_RUNGS.BULK,
    });

    return {
      checkpoint,
      ...suggestionRecord,
    };
  });
}

export async function createCanvasItemWrite(input: {
  actor: ActorContext;
  canvasId: string;
  itemData: AgentItemWriteData;
  summary: string;
  rung?: number;
  actionKind?: AgentActionKind;
  /** Extra writes that must commit with the item (e.g. its enrichment job). */
  afterCreate?: (
    tx: Prisma.TransactionClient,
    item: PrismaCanvasItem,
  ) => Promise<void>;
}) {
  const normalizedItem = normalizeAgentItemWriteData(input.itemData);

  return prisma.$transaction(async (tx) => {
    await lockCanvasForMutation(tx, input.canvasId);
    await getOwnedCanvasTx(tx, input.actor.userId, input.canvasId);
    await assertCanvasItemCapacity(tx, input.canvasId);

    const agentAction = await tx.agentAction.create({
      data: {
        userId: input.actor.userId,
        agentProfileId: input.actor.agentProfileId,
        integrationAccountId: input.actor.integrationAccountId ?? null,
        modelCredentialId: input.actor.modelCredentialId ?? null,
        kind: input.actionKind ?? AgentActionKind.WRITE,
        rung: input.rung ?? AGENT_CAPABILITY_RUNGS.WRITE_SINGLE,
        status: AgentActionStatus.RUNNING,
        summary: input.summary,
        requestFingerprint: buildRequestFingerprint({
          canvasId: input.canvasId,
          itemData: normalizedItem,
          summary: input.summary,
        }),
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
        summary: input.summary,
      },
    });

    const item = await tx.canvasItem.create({
      data: {
        canvasId: input.canvasId,
        type: normalizedItem.type as any,
        positionX: normalizedItem.positionX,
        positionY: normalizedItem.positionY,
        width: normalizedItem.width,
        height: normalizedItem.height,
        zIndex: normalizedItem.zIndex,
        content: toJsonValue(normalizedItem.content),
        tags: normalizedItem.tags,
        version: 1,
        createdById: input.actor.userId,
        updatedById: input.actor.userId,
      },
    });
    await recordCanvasItemEvent(tx, {
      canvasId: input.canvasId,
      actorId: input.actor.userId,
      itemId: item.id,
      version: item.version,
      operation: "created",
    });

    await tx.changeRecord.create({
      data: {
        changeSetId: changeSet.id,
        targetType: "CanvasItem",
        targetId: item.id,
        operation: "CREATE",
        before: Prisma.JsonNull,
        after: toJsonValue(item),
        reversible: true,
      },
    });

    await completeChangeSetTx(tx, {
      agentActionId: agentAction.id,
      changeSetId: changeSet.id,
    });
    await input.afterCreate?.(tx, item);

    return { item, agentActionId: agentAction.id, changeSetId: changeSet.id };
  });
}

export async function createCanvasItemBatchWrite(input: {
  actor: ActorContext;
  canvasId: string;
  items: unknown[];
  summary: string;
  rung?: number;
  actionKind?: AgentActionKind;
  checkpointId?: string | null;
  checkpointReason?: string;
}) {
  const normalizedItems = normalizeAgentItemWriteBatch(input.items);
  const rung = input.rung ?? AGENT_CAPABILITY_RUNGS.WRITE_GROUP;

  if (normalizedItems.length === 0) {
    throw new BadRequestError("At least one item is required.");
  }

  return prisma.$transaction(async (tx) => {
    await lockCanvasForMutation(tx, input.canvasId);
    await getOwnedCanvasTx(tx, input.actor.userId, input.canvasId);
    await assertCanvasItemCapacity(tx, input.canvasId, normalizedItems.length);

    let checkpointId = input.checkpointId ?? null;
    if (rung >= AGENT_CAPABILITY_RUNGS.BULK) {
      if (checkpointId) {
        const checkpoint = await tx.workspaceCheckpoint.findFirst({
          where: {
            id: checkpointId,
            userId: input.actor.userId,
            scopeType: "canvas",
            scopeId: input.canvasId,
          },
          select: { id: true },
        });

        if (!checkpoint) {
          throw new NotFoundError(
            "Workspace checkpoint not found for this canvas.",
          );
        }
      } else {
        const checkpoint = await createCanvasCheckpointTx(tx, {
          actor: input.actor,
          canvasId: input.canvasId,
          reason: input.checkpointReason || input.summary,
        });
        checkpointId = checkpoint.id;
      }
    }

    const agentAction = await tx.agentAction.create({
      data: {
        userId: input.actor.userId,
        agentProfileId: input.actor.agentProfileId,
        integrationAccountId: input.actor.integrationAccountId ?? null,
        modelCredentialId: input.actor.modelCredentialId ?? null,
        kind: input.actionKind ?? AgentActionKind.WRITE,
        rung,
        status: AgentActionStatus.RUNNING,
        summary: input.summary,
        requestFingerprint: buildRequestFingerprint({
          canvasId: input.canvasId,
          items: normalizedItems,
          summary: input.summary,
          checkpointId,
        }),
        metadata:
          checkpointId === null
            ? undefined
            : toJsonValue({
                checkpointId,
              }),
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
        summary: input.summary,
      },
    });

    const createdItems = [];
    for (const itemData of normalizedItems) {
      const item = await tx.canvasItem.create({
        data: {
          canvasId: input.canvasId,
          type: itemData.type as any,
          positionX: itemData.positionX,
          positionY: itemData.positionY,
          width: itemData.width,
          height: itemData.height,
          zIndex: itemData.zIndex,
          content: toJsonValue(itemData.content),
          tags: itemData.tags,
          version: 1,
          createdById: input.actor.userId,
          updatedById: input.actor.userId,
        },
      });

      createdItems.push(item);
    }
    await recordCanvasItemEventsBatch(
      tx,
      createdItems.map((item) => ({
        canvasId: input.canvasId,
        actorId: input.actor.userId,
        itemId: item.id,
        version: item.version,
        operation: "created" as const,
      })),
    );

    await tx.changeRecord.createMany({
      data: createdItems.map((item) => ({
        changeSetId: changeSet.id,
        targetType: "CanvasItem",
        targetId: item.id,
        operation: "CREATE",
        before: Prisma.JsonNull,
        after: toJsonValue(item),
        reversible: true,
      })),
    });

    await completeChangeSetTx(tx, {
      agentActionId: agentAction.id,
      changeSetId: changeSet.id,
    });

    return {
      items: createdItems,
      checkpointId,
      agentActionId: agentAction.id,
      changeSetId: changeSet.id,
    };
  });
}

export async function createCanvasItemComment(input: {
  actor: ActorContext;
  itemId: string;
  content: string;
  summary: string;
}) {
  const sanitizedContent = sanitizeComment(input.content);

  return prisma.$transaction(async (tx) => {
    const item = await getCanvasItemScopeTx(
      tx,
      input.actor.userId,
      input.itemId,
    );

    const agentAction = await tx.agentAction.create({
      data: {
        userId: input.actor.userId,
        agentProfileId: input.actor.agentProfileId,
        integrationAccountId: input.actor.integrationAccountId ?? null,
        modelCredentialId: input.actor.modelCredentialId ?? null,
        kind: AgentActionKind.COMMENT,
        rung: AGENT_CAPABILITY_RUNGS.COMMENT,
        status: AgentActionStatus.RUNNING,
        summary: input.summary,
        requestFingerprint: buildRequestFingerprint({
          itemId: input.itemId,
          content: sanitizedContent,
          summary: input.summary,
        }),
      },
    });

    const changeSet = await tx.changeSet.create({
      data: {
        userId: input.actor.userId,
        agentProfileId: input.actor.agentProfileId,
        agentActionId: agentAction.id,
        scopeType: "canvas",
        scopeId: item.canvasId,
        status: ChangeSetStatus.RUNNING,
        summary: input.summary,
      },
    });

    const comment = await tx.comment.create({
      data: {
        itemId: input.itemId,
        userId: input.actor.userId,
        content: sanitizedContent,
      },
    });

    await tx.changeRecord.create({
      data: {
        changeSetId: changeSet.id,
        targetType: "Comment",
        targetId: comment.id,
        operation: "CREATE",
        before: Prisma.JsonNull,
        after: toJsonValue(comment),
        reversible: true,
      },
    });

    await completeChangeSetTx(tx, {
      agentActionId: agentAction.id,
      changeSetId: changeSet.id,
    });

    return {
      comment,
      agentActionId: agentAction.id,
      changeSetId: changeSet.id,
    };
  });
}

export async function createKnowledgeEntityWrite(input: {
  actor: ActorContext;
  itemId: string;
  entityType: string;
  title: string;
  summary?: string;
  attributes?: unknown;
  sourceConfidence?: number;
}) {
  return prisma.$transaction(async (tx) => {
    const item = await getCanvasItemScopeTx(
      tx,
      input.actor.userId,
      input.itemId,
    );

    const agentAction = await tx.agentAction.create({
      data: {
        userId: input.actor.userId,
        agentProfileId: input.actor.agentProfileId,
        integrationAccountId: input.actor.integrationAccountId ?? null,
        modelCredentialId: input.actor.modelCredentialId ?? null,
        kind: AgentActionKind.WRITE,
        rung: AGENT_CAPABILITY_RUNGS.WRITE_SINGLE,
        status: AgentActionStatus.RUNNING,
        summary: `Create knowledge entity: ${input.title}`,
        requestFingerprint: buildRequestFingerprint(input),
      },
    });

    const changeSet = await tx.changeSet.create({
      data: {
        userId: input.actor.userId,
        agentProfileId: input.actor.agentProfileId,
        agentActionId: agentAction.id,
        scopeType: "canvas",
        scopeId: item.canvasId,
        status: ChangeSetStatus.RUNNING,
        summary: `Create knowledge entity: ${input.title}`,
      },
    });

    const knowledgeEntity = await tx.knowledgeEntity.create({
      data: {
        userId: input.actor.userId,
        entityType: input.entityType,
        title: input.title,
        summary: input.summary,
        attributes:
          input.attributes === undefined
            ? undefined
            : toJsonValue(input.attributes),
        sourceConfidence: input.sourceConfidence,
      },
    });

    const itemEntityLink = await tx.itemEntityLink.create({
      data: {
        itemId: input.itemId,
        knowledgeEntityId: knowledgeEntity.id,
        linkType: ItemEntityLinkType.SOURCE,
        confidence: input.sourceConfidence,
      },
    });

    await tx.changeRecord.createMany({
      data: [
        {
          changeSetId: changeSet.id,
          targetType: "KnowledgeEntity",
          targetId: knowledgeEntity.id,
          operation: "CREATE",
          before: Prisma.JsonNull,
          after: toJsonValue(knowledgeEntity),
          reversible: true,
        },
        {
          changeSetId: changeSet.id,
          targetType: "ItemEntityLink",
          targetId: itemEntityLink.id,
          operation: "CREATE",
          before: Prisma.JsonNull,
          after: toJsonValue(itemEntityLink),
          reversible: true,
        },
      ],
    });

    await completeChangeSetTx(tx, {
      agentActionId: agentAction.id,
      changeSetId: changeSet.id,
    });

    return {
      knowledgeEntity,
      itemEntityLink,
      agentActionId: agentAction.id,
      changeSetId: changeSet.id,
    };
  });
}

export async function createKnowledgeRelationWrite(input: {
  actor: ActorContext;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
  summary?: string;
  attributes?: unknown;
  confidence?: number;
}) {
  if (input.sourceEntityId === input.targetEntityId) {
    throw new BadRequestError(
      "Knowledge relations cannot target the same entity on both ends.",
    );
  }

  return prisma.$transaction(async (tx) => {
    const sourceEntity = await getKnowledgeEntityScopeTx(
      tx,
      input.actor.userId,
      input.sourceEntityId,
    );
    const targetEntity = await getKnowledgeEntityScopeTx(
      tx,
      input.actor.userId,
      input.targetEntityId,
    );

    const canvasId = getSharedCanvasId(
      sourceEntity.canvasIds,
      targetEntity.canvasIds,
    );

    const existingRelation = await tx.knowledgeRelation.findFirst({
      where: {
        sourceEntityId: input.sourceEntityId,
        targetEntityId: input.targetEntityId,
        relationType: input.relationType,
      },
      select: {
        id: true,
      },
    });

    if (existingRelation) {
      throw new BadRequestError("Knowledge relation already exists.");
    }

    const summary =
      input.summary ||
      `Create knowledge relation: ${sourceEntity.title} -[${input.relationType}]-> ${targetEntity.title}`;

    const agentAction = await tx.agentAction.create({
      data: {
        userId: input.actor.userId,
        agentProfileId: input.actor.agentProfileId,
        integrationAccountId: input.actor.integrationAccountId ?? null,
        modelCredentialId: input.actor.modelCredentialId ?? null,
        kind: AgentActionKind.WRITE,
        rung: AGENT_CAPABILITY_RUNGS.WRITE_SINGLE,
        status: AgentActionStatus.RUNNING,
        summary,
        requestFingerprint: buildRequestFingerprint(input),
      },
    });

    const changeSet = await tx.changeSet.create({
      data: {
        userId: input.actor.userId,
        agentProfileId: input.actor.agentProfileId,
        agentActionId: agentAction.id,
        scopeType: "canvas",
        scopeId: canvasId,
        status: ChangeSetStatus.RUNNING,
        summary,
      },
    });

    const knowledgeRelation = await tx.knowledgeRelation.create({
      data: {
        userId: input.actor.userId,
        sourceEntityId: input.sourceEntityId,
        targetEntityId: input.targetEntityId,
        relationType: input.relationType,
        summary: input.summary,
        attributes:
          input.attributes === undefined
            ? undefined
            : toJsonValue(input.attributes),
        confidence: input.confidence,
      },
    });

    await tx.changeRecord.create({
      data: {
        changeSetId: changeSet.id,
        targetType: "KnowledgeRelation",
        targetId: knowledgeRelation.id,
        operation: "CREATE",
        before: Prisma.JsonNull,
        after: toJsonValue(knowledgeRelation),
        reversible: true,
      },
    });

    await completeChangeSetTx(tx, {
      agentActionId: agentAction.id,
      changeSetId: changeSet.id,
    });

    return {
      knowledgeRelation,
      agentActionId: agentAction.id,
      changeSetId: changeSet.id,
    };
  });
}

async function readOwnedSuggestion(userId: string, suggestionId: string) {
  const suggestion = await prisma.suggestion.findFirst({
    where: { id: suggestionId, userId },
  });
  if (!suggestion) {
    throw new NotFoundError("Suggestion not found.");
  }
  return suggestion;
}

async function expireOpenSuggestion(userId: string, suggestionId: string) {
  await prisma.suggestion.updateMany({
    where: { id: suggestionId, userId, status: SuggestionStatus.OPEN },
    data: {
      status: SuggestionStatus.EXPIRED,
      actedAt: new Date(),
    },
  });
}

/**
 * Approval and rejection are compare-and-set transitions: the write only
 * applies while the row is still in an allowed source status, so a slow
 * request cannot move an EXECUTING, EXECUTED or REJECTED suggestion back.
 */
export async function approveSuggestion(input: {
  userId: string;
  suggestionId: string;
}) {
  const assertApprovable = async (
    suggestion: Awaited<ReturnType<typeof readOwnedSuggestion>>,
  ) => {
    if (suggestion.status !== SuggestionStatus.OPEN) {
      throw new BadRequestError("Only open suggestions can be approved.");
    }
    if (suggestion.expiresAt <= new Date()) {
      await expireOpenSuggestion(input.userId, suggestion.id);
      throw new BadRequestError("This suggestion has expired.");
    }
  };

  await assertApprovable(
    await readOwnedSuggestion(input.userId, input.suggestionId),
  );

  const approved = await prisma.suggestion.updateMany({
    where: {
      id: input.suggestionId,
      userId: input.userId,
      status: SuggestionStatus.OPEN,
      expiresAt: { gt: new Date() },
    },
    data: {
      status: SuggestionStatus.APPROVED,
      actedAt: new Date(),
    },
  });

  const current = await readOwnedSuggestion(input.userId, input.suggestionId);
  if (approved.count !== 1) {
    await assertApprovable(current);
    throw new BadRequestError("Only open suggestions can be approved.");
  }
  return current;
}

export async function rejectSuggestion(input: {
  userId: string;
  suggestionId: string;
}) {
  const rejectable: SuggestionStatus[] = [
    SuggestionStatus.OPEN,
    SuggestionStatus.APPROVED,
  ];
  const notRejectable = () =>
    new BadRequestError("Only open or approved suggestions can be rejected.");

  const suggestion = await readOwnedSuggestion(
    input.userId,
    input.suggestionId,
  );
  if (!rejectable.includes(suggestion.status)) {
    throw notRejectable();
  }

  const rejected = await prisma.suggestion.updateMany({
    where: {
      id: input.suggestionId,
      userId: input.userId,
      status: { in: rejectable },
    },
    data: {
      status: SuggestionStatus.REJECTED,
      actedAt: new Date(),
    },
  });

  const current = await readOwnedSuggestion(input.userId, input.suggestionId);
  if (rejected.count !== 1) {
    throw notRejectable();
  }
  return current;
}

export async function markSuggestionExecuted(input: {
  userId: string;
  suggestionId: string;
}) {
  return prisma.suggestion.updateMany({
    where: {
      id: input.suggestionId,
      userId: input.userId,
      status: SuggestionStatus.EXECUTING,
    },
    data: {
      status: SuggestionStatus.EXECUTED,
      actedAt: new Date(),
    },
  });
}

/**
 * Returns a claimed suggestion to APPROVED after its internal write failed
 * and rolled back. Conditional on EXECUTING, so it never revives a row that
 * finished or was rejected meanwhile.
 */
export async function releaseSuggestionClaim(input: {
  userId: string;
  suggestionId: string;
}) {
  return prisma.suggestion.updateMany({
    where: {
      id: input.suggestionId,
      userId: input.userId,
      status: SuggestionStatus.EXECUTING,
    },
    data: {
      status: SuggestionStatus.APPROVED,
      actedAt: new Date(),
    },
  });
}

export async function claimSuggestionForExecution(input: {
  userId: string;
  suggestionId: string;
}) {
  const claimed = await prisma.suggestion.updateMany({
    where: {
      id: input.suggestionId,
      userId: input.userId,
      status: SuggestionStatus.APPROVED,
      expiresAt: { gt: new Date() },
    },
    data: {
      status: SuggestionStatus.EXECUTING,
      actedAt: new Date(),
    },
  });

  if (claimed.count !== 1) {
    throw new BadRequestError(
      "Suggestion is expired, already executing, or already executed.",
    );
  }
}

export { executeExternalWebhook } from "@/lib/agents/external-webhook-service";

async function applyRevertOperation(
  tx: Prisma.TransactionClient,
  changeRecord: {
    id: string;
    targetType: string;
    targetId: string;
    operation: string;
    before: Prisma.JsonValue | null;
    after: Prisma.JsonValue | null;
    reversible: boolean;
  },
  userId: string,
  rollbackChangeSetId: string,
) {
  if (!changeRecord.reversible) {
    throw new BadRequestError(
      `Change record ${changeRecord.id} is not reversible.`,
    );
  }

  if (
    changeRecord.targetType === "CanvasItem" &&
    changeRecord.operation === ARCHIVE_OPERATION
  ) {
    // IMP-070: an archived item goes back onto its board.
    await revertArchivedItem(tx, {
      targetId: changeRecord.targetId,
      userId,
      rollbackChangeSetId,
    });
    return;
  }

  if (
    changeRecord.targetType === "CanvasItem" &&
    changeRecord.operation === "CREATE"
  ) {
    const existing = await tx.canvasItem.findUnique({
      where: { id: changeRecord.targetId },
    });
    if (existing && existing.deletedAt === null) {
      const deletedAt = new Date();
      await lockCanvasForMutation(tx, existing.canvasId);
      const deleted = await tx.canvasItem.update({
        where: { id: changeRecord.targetId },
        data: {
          deletedAt,
          deletedById: userId,
          updatedById: userId,
          version: {
            increment: 1,
          },
        },
      });
      await recordCanvasItemEvent(tx, {
        canvasId: deleted.canvasId,
        actorId: userId,
        itemId: deleted.id,
        version: deleted.version,
        operation: "deleted",
      });

      await tx.changeRecord.create({
        data: {
          changeSetId: rollbackChangeSetId,
          targetType: "CanvasItem",
          targetId: changeRecord.targetId,
          operation: "ROLLBACK_CREATE",
          before: toJsonValue(existing),
          after: toJsonValue({ ...existing, deletedAt }),
          reversible: true,
        },
      });
    }
    return;
  }

  if (
    changeRecord.targetType === "Comment" &&
    changeRecord.operation === "CREATE"
  ) {
    const existing = await tx.comment.findUnique({
      where: { id: changeRecord.targetId },
    });
    if (existing && existing.deletedAt === null) {
      const deletedAt = new Date();
      await tx.comment.update({
        where: { id: changeRecord.targetId },
        data: {
          deletedAt,
        },
      });

      await tx.changeRecord.create({
        data: {
          changeSetId: rollbackChangeSetId,
          targetType: "Comment",
          targetId: changeRecord.targetId,
          operation: "ROLLBACK_CREATE",
          before: toJsonValue(existing),
          after: toJsonValue({ ...existing, deletedAt }),
          reversible: true,
        },
      });
    }
    return;
  }

  if (
    changeRecord.targetType === "KnowledgeEntity" &&
    changeRecord.operation === "CREATE"
  ) {
    const existing = await tx.knowledgeEntity.findUnique({
      where: { id: changeRecord.targetId },
    });
    if (existing) {
      await tx.knowledgeEntity.delete({ where: { id: changeRecord.targetId } });
      await tx.changeRecord.create({
        data: {
          changeSetId: rollbackChangeSetId,
          targetType: "KnowledgeEntity",
          targetId: changeRecord.targetId,
          operation: "ROLLBACK_CREATE",
          before: toJsonValue(existing),
          after: Prisma.JsonNull,
          reversible: true,
        },
      });
    }
    return;
  }

  if (
    changeRecord.targetType === "ItemEntityLink" &&
    changeRecord.operation === "CREATE"
  ) {
    const existing = await tx.itemEntityLink.findUnique({
      where: { id: changeRecord.targetId },
    });
    if (existing) {
      await tx.itemEntityLink.delete({ where: { id: changeRecord.targetId } });
      await tx.changeRecord.create({
        data: {
          changeSetId: rollbackChangeSetId,
          targetType: "ItemEntityLink",
          targetId: changeRecord.targetId,
          operation: "ROLLBACK_CREATE",
          before: toJsonValue(existing),
          after: Prisma.JsonNull,
          reversible: true,
        },
      });
    }
    return;
  }

  if (
    changeRecord.targetType === "KnowledgeRelation" &&
    changeRecord.operation === "CREATE"
  ) {
    const existing = await tx.knowledgeRelation.findUnique({
      where: { id: changeRecord.targetId },
    });
    if (existing) {
      await tx.knowledgeRelation.delete({
        where: { id: changeRecord.targetId },
      });
      await tx.changeRecord.create({
        data: {
          changeSetId: rollbackChangeSetId,
          targetType: "KnowledgeRelation",
          targetId: changeRecord.targetId,
          operation: "ROLLBACK_CREATE",
          before: toJsonValue(existing),
          after: Prisma.JsonNull,
          reversible: true,
        },
      });
    }
    return;
  }

  if (
    changeRecord.targetType === "Canvas" &&
    changeRecord.operation === "CREATE"
  ) {
    // A board an agent made (boards_create). Undo removes it only while it
    // holds nothing, so the user's later additions are never lost.
    const existing = await tx.canvas.findUnique({
      where: { id: changeRecord.targetId },
      select: { id: true, name: true, userId: true, createdAt: true },
    });
    if (existing) {
      const [liveItems, liveUploads] = await Promise.all([
        tx.canvasItem.count({
          where: { canvasId: existing.id, deletedAt: null },
        }),
        tx.uploadAsset.count({
          where: { canvasId: existing.id, status: { not: "DELETED" } },
        }),
      ]);
      if (liveItems > 0 || liveUploads > 0) {
        throw new BadRequestError(
          "This board has items on it now. Undo those first, or delete the board in Memoria.",
        );
      }
      await tx.canvas.delete({ where: { id: existing.id } });
      await tx.changeRecord.create({
        data: {
          changeSetId: rollbackChangeSetId,
          targetType: "Canvas",
          targetId: changeRecord.targetId,
          operation: "ROLLBACK_CREATE",
          before: toJsonValue(existing),
          after: Prisma.JsonNull,
          reversible: false,
        },
      });
    }

    const grantedAgentProfileId =
      changeRecord.after &&
      typeof changeRecord.after === "object" &&
      !Array.isArray(changeRecord.after) &&
      typeof changeRecord.after.grantedAgentProfileId === "string"
        ? changeRecord.after.grantedAgentProfileId
        : null;
    if (grantedAgentProfileId) {
      const profile = await tx.agentProfile.findFirst({
        where: { id: grantedAgentProfileId, userId },
        select: { allowedCanvasIds: true },
      });
      if (profile?.allowedCanvasIds.includes(changeRecord.targetId)) {
        await tx.agentProfile.update({
          where: { id: grantedAgentProfileId },
          data: {
            allowedCanvasIds: profile.allowedCanvasIds.filter(
              (canvasId) => canvasId !== changeRecord.targetId,
            ),
          },
        });
      }
    }
    return;
  }

  if (
    changeRecord.targetType === "CanvasItem" &&
    changeRecord.operation === "MOVE" &&
    changeRecord.before
  ) {
    // An approved Ask command moved this item to another board (IMP-068).
    // Undo returns it to the board and spot it came from.
    const snapshot = changeRecord.before as unknown as PrismaCanvasItem;
    const existing = await tx.canvasItem.findFirst({
      where: {
        id: changeRecord.targetId,
        canvas: { userId },
      },
    });
    if (!existing) {
      throw new NotFoundError(
        `Canvas item ${changeRecord.targetId} no longer exists.`,
      );
    }
    const source = await tx.canvas.findFirst({
      where: { id: snapshot.canvasId, userId },
      select: { id: true },
    });
    if (!source) {
      throw new BadRequestError(
        "The board this item came from is gone, so it cannot go back.",
      );
    }
    for (const canvasId of [existing.canvasId, snapshot.canvasId].sort()) {
      await lockCanvasForMutation(tx, canvasId);
    }
    const reverted = await tx.canvasItem.update({
      where: { id: changeRecord.targetId },
      data: {
        canvasId: snapshot.canvasId,
        positionX: snapshot.positionX,
        positionY: snapshot.positionY,
        version: { increment: 1 },
        updatedById: userId,
      },
    });
    if (existing.canvasId !== snapshot.canvasId) {
      await recordCanvasItemEvent(tx, {
        canvasId: existing.canvasId,
        actorId: userId,
        itemId: reverted.id,
        version: reverted.version,
        operation: "deleted",
      });
    }
    await recordCanvasItemEvent(tx, {
      canvasId: snapshot.canvasId,
      actorId: userId,
      itemId: reverted.id,
      version: reverted.version,
      operation:
        existing.canvasId !== snapshot.canvasId ? "created" : "updated",
    });
    await tx.changeRecord.create({
      data: {
        changeSetId: rollbackChangeSetId,
        targetType: "CanvasItem",
        targetId: changeRecord.targetId,
        operation: "ROLLBACK_MOVE",
        before: toJsonValue(existing),
        after: toJsonValue(reverted),
        reversible: false,
      },
    });
    return;
  }

  if (
    changeRecord.targetType === "ItemConnection" &&
    changeRecord.operation === "DELETE" &&
    changeRecord.before
  ) {
    // A line an approved move dropped from the old board (IMP-072). The move
    // records sort newer, so the items are already back; the line returns
    // only while both ends are on that board and nothing has replaced it.
    const snapshot = changeRecord.before as unknown as {
      id: string;
      canvasId: string;
      fromId: string;
      toId: string;
      label: string | null;
      style: string;
      createdAt: string;
    };
    const board = await tx.canvas.findFirst({
      where: { id: snapshot.canvasId, userId },
      select: { id: true },
    });
    if (!board) return;
    await lockCanvasForMutation(tx, snapshot.canvasId);
    const endpointIds = Array.from(new Set([snapshot.fromId, snapshot.toId]));
    const [endpoints, clash] = await Promise.all([
      tx.canvasItem.count({
        where: { id: { in: endpointIds }, canvasId: snapshot.canvasId },
      }),
      tx.itemConnection.findFirst({
        where: {
          OR: [
            { id: snapshot.id },
            {
              canvasId: snapshot.canvasId,
              fromId: snapshot.fromId,
              toId: snapshot.toId,
            },
          ],
        },
        select: { id: true },
      }),
    ]);
    if (endpoints !== endpointIds.length || clash) return;
    const restored = await tx.itemConnection.create({
      data: {
        id: snapshot.id,
        canvasId: snapshot.canvasId,
        fromId: snapshot.fromId,
        toId: snapshot.toId,
        label: snapshot.label,
        style: snapshot.style,
        createdAt: new Date(snapshot.createdAt),
      },
    });
    await tx.changeRecord.create({
      data: {
        changeSetId: rollbackChangeSetId,
        targetType: "ItemConnection",
        targetId: restored.id,
        operation: "ROLLBACK_DELETE",
        before: Prisma.JsonNull,
        after: toJsonValue(restored),
        reversible: false,
      },
    });
    return;
  }

  if (
    changeRecord.operation === "UPDATE" &&
    changeRecord.before &&
    changeRecord.targetType === "CanvasItem"
  ) {
    const snapshot = changeRecord.before as unknown as PrismaCanvasItem;
    const existing = await tx.canvasItem.findUnique({
      where: { id: changeRecord.targetId },
    });
    if (!existing) {
      throw new NotFoundError(
        `Canvas item ${changeRecord.targetId} no longer exists.`,
      );
    }

    await lockCanvasForMutation(tx, existing.canvasId);
    const reverted = await tx.canvasItem.update({
      where: { id: changeRecord.targetId },
      data: {
        positionX: snapshot.positionX,
        positionY: snapshot.positionY,
        width: snapshot.width,
        height: snapshot.height,
        zIndex: snapshot.zIndex,
        content: toJsonValue(snapshot.content),
        tags: snapshot.tags,
        version: {
          increment: 1,
        },
        updatedById: userId,
      },
    });
    await recordCanvasItemEvent(tx, {
      canvasId: reverted.canvasId,
      actorId: userId,
      itemId: reverted.id,
      version: reverted.version,
      operation: "updated",
    });

    await tx.changeRecord.create({
      data: {
        changeSetId: rollbackChangeSetId,
        targetType: "CanvasItem",
        targetId: changeRecord.targetId,
        operation: "ROLLBACK_UPDATE",
        before: toJsonValue(existing),
        after: toJsonValue(snapshot),
        reversible: true,
      },
    });
    return;
  }

  throw new BadRequestError(
    `Unsupported revert operation for ${changeRecord.targetType}:${changeRecord.operation}.`,
  );
}

/**
 * Authorizes an agent or integration token to revert a change set. A token may
 * only undo change sets made under its own agent profile, and only on canvases
 * its allowlist still covers. A canvas-scoped change set is checked by its
 * scope; any other scope is checked through the current canvas of every
 * record it touches, and a record whose canvas cannot be resolved is denied.
 * User-session undo does not go through this check.
 */
export async function assertAgentMayRevertChangeSet(input: {
  userId: string;
  agentProfile: Parameters<typeof assertCanvasScope>[0] & { id: string };
  changeSetId: string;
}) {
  const changeSet = await prisma.changeSet.findFirst({
    where: { id: input.changeSetId, userId: input.userId },
    select: {
      id: true,
      agentProfileId: true,
      scopeType: true,
      scopeId: true,
      changeRecords: { select: { targetType: true, targetId: true } },
    },
  });

  if (!changeSet) {
    throw new NotFoundError("Change set not found.");
  }

  if (changeSet.agentProfileId !== input.agentProfile.id) {
    throw new ForbiddenError(
      "The selected agent profile did not make this change set.",
    );
  }

  if (changeSet.scopeType === "canvas") {
    assertCanvasScope(input.agentProfile, changeSet.scopeId);
    return;
  }

  const itemIds = [
    ...new Set(
      changeSet.changeRecords
        .filter((record) => record.targetType === "CanvasItem")
        .map((record) => record.targetId),
    ),
  ];
  const items = itemIds.length
    ? await prisma.canvasItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, canvasId: true },
      })
    : [];
  const canvasByItem = new Map(items.map((item) => [item.id, item.canvasId]));

  for (const record of changeSet.changeRecords) {
    const canvasId =
      record.targetType === "CanvasItem"
        ? canvasByItem.get(record.targetId)
        : record.targetType === "Canvas"
          ? record.targetId
          : undefined;
    if (!canvasId) {
      throw new ForbiddenError(
        "The selected agent profile is not allowed to revert this change set.",
      );
    }
    assertCanvasScope(input.agentProfile, canvasId);
  }
}

export async function revertChangeSet(input: {
  actor: ActorContext;
  changeSetId: string;
}) {
  const originalChangeSet = await prisma.changeSet.findFirst({
    where: {
      id: input.changeSetId,
      userId: input.actor.userId,
    },
    include: {
      changeRecords: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!originalChangeSet) {
    throw new NotFoundError("Change set not found.");
  }

  if (originalChangeSet.revertedAt) {
    throw new ForbiddenError("This change set has already been reverted.");
  }

  return prisma.$transaction(async (tx) => {
    if (originalChangeSet.scopeType === "canvas") {
      await lockCanvasForMutation(tx, originalChangeSet.scopeId);
    }
    const rollbackAction = await tx.agentAction.create({
      data: {
        userId: input.actor.userId,
        agentProfileId: input.actor.agentProfileId,
        integrationAccountId: input.actor.integrationAccountId ?? null,
        modelCredentialId: input.actor.modelCredentialId ?? null,
        kind: AgentActionKind.ROLLBACK,
        rung: AGENT_CAPABILITY_RUNGS.WRITE_SINGLE,
        status: AgentActionStatus.RUNNING,
        summary: `Rollback change set ${originalChangeSet.id}`,
        requestFingerprint: buildRequestFingerprint({
          changeSetId: originalChangeSet.id,
          rollback: true,
        }),
      },
    });

    const rollbackChangeSet = await tx.changeSet.create({
      data: {
        userId: input.actor.userId,
        agentProfileId: input.actor.agentProfileId,
        agentActionId: rollbackAction.id,
        scopeType: originalChangeSet.scopeType,
        scopeId: originalChangeSet.scopeId,
        status: ChangeSetStatus.RUNNING,
        summary: `Rollback change set ${originalChangeSet.id}`,
      },
    });

    for (const changeRecord of originalChangeSet.changeRecords) {
      await applyRevertOperation(
        tx,
        changeRecord,
        input.actor.userId,
        rollbackChangeSet.id,
      );
    }

    const revertedAt = new Date();

    await tx.changeRecord.updateMany({
      where: {
        changeSetId: originalChangeSet.id,
        revertedAt: null,
      },
      data: {
        revertedAt,
      },
    });

    await tx.changeSet.update({
      where: { id: originalChangeSet.id },
      data: {
        status: ChangeSetStatus.REVERTED,
        revertedAt,
      },
    });

    await tx.changeSet.update({
      where: { id: rollbackChangeSet.id },
      data: {
        status: ChangeSetStatus.COMPLETED,
        completedAt: revertedAt,
      },
    });

    await tx.agentAction.update({
      where: { id: rollbackAction.id },
      data: {
        status: AgentActionStatus.COMPLETED,
      },
    });

    return {
      rollbackActionId: rollbackAction.id,
      rollbackChangeSetId: rollbackChangeSet.id,
      revertedChangeSetId: originalChangeSet.id,
    };
  });
}
