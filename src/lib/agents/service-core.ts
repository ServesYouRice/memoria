import { createHash } from "crypto";
import {
  AgentActionKind,
  AgentActionStatus,
  ChangeSetStatus,
  IntegrationProviderType,
  ItemEntityLinkType,
  Prisma,
  SuggestionStatus,
  WorkspaceCheckpointActorType,
  type CanvasItem as PrismaCanvasItem,
  type SuggestionKind,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { BadRequestError, ForbiddenError, NotFoundError } from "@/lib/errors";
import {
  DEFAULT_SUGGESTION_TTL_DAYS,
  AGENT_CAPABILITY_RUNGS,
} from "@/lib/agents/constants";
import { decryptSecret } from "@/lib/agents/crypto";
import { deliverSignedWebhook } from "@/lib/agents/webhooks";
import { sanitizeComment } from "@/lib/sanitization";
import { validateUrlForSsrf } from "@/lib/utils/ssrf-protection";
import { parseCanvasItemContent } from "@/lib/validation/canvas-item";
import { ItemType } from "@/types/canvas";

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

const externalWebhookRequestSchema = z.object({
  method: z.enum(["POST", "PUT", "PATCH"]).default("POST"),
  path: z.string().min(1).max(2048).optional(),
  headers: z.record(z.string(), z.string().max(2000)).default({}),
  body: z.unknown(),
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

async function createSuggestionRecordTx(
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

function normalizeReplayCursor(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return { ...(value as Record<string, unknown>) };
}

function getWebhookSigningSecret(replayCursor: Prisma.JsonValue | null) {
  const normalized = normalizeReplayCursor(replayCursor);
  const encryptedSecret = normalized.outboundSigningSecret;

  if (typeof encryptedSecret !== "string") {
    throw new BadRequestError(
      "The selected webhook integration is missing an outbound signing secret.",
    );
  }

  return decryptSecret(encryptedSecret);
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
}) {
  const normalizedItem = normalizeAgentItemWriteData(input.itemData);

  return prisma.$transaction(async (tx) => {
    await getOwnedCanvasTx(tx, input.actor.userId, input.canvasId);

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
    await getOwnedCanvasTx(tx, input.actor.userId, input.canvasId);

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

export async function approveSuggestion(input: {
  userId: string;
  suggestionId: string;
}) {
  const suggestion = await prisma.suggestion.findFirst({
    where: {
      id: input.suggestionId,
      userId: input.userId,
    },
  });

  if (!suggestion) {
    throw new NotFoundError("Suggestion not found.");
  }

  if (suggestion.status !== SuggestionStatus.OPEN) {
    throw new BadRequestError("Only open suggestions can be approved.");
  }

  if (suggestion.expiresAt <= new Date()) {
    await prisma.suggestion.update({
      where: { id: suggestion.id },
      data: {
        status: SuggestionStatus.EXPIRED,
        actedAt: new Date(),
      },
    });

    throw new BadRequestError("This suggestion has expired.");
  }

  return prisma.suggestion.update({
    where: { id: suggestion.id },
    data: {
      status: SuggestionStatus.APPROVED,
      actedAt: new Date(),
    },
  });
}

export async function rejectSuggestion(input: {
  userId: string;
  suggestionId: string;
}) {
  const suggestion = await prisma.suggestion.findFirst({
    where: {
      id: input.suggestionId,
      userId: input.userId,
    },
  });

  if (!suggestion) {
    throw new NotFoundError("Suggestion not found.");
  }

  if (
    suggestion.status !== SuggestionStatus.OPEN &&
    suggestion.status !== SuggestionStatus.APPROVED
  ) {
    throw new BadRequestError(
      "Only open or approved suggestions can be rejected.",
    );
  }

  return prisma.suggestion.update({
    where: { id: suggestion.id },
    data: {
      status: SuggestionStatus.REJECTED,
      actedAt: new Date(),
    },
  });
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

export async function executeExternalWebhook(input: {
  actor: ActorContext;
  integrationAccountId: string;
  summary: string;
  request: unknown;
  metadata?: unknown;
}) {
  const requestData = externalWebhookRequestSchema.parse(input.request);

  const integrationAccount = await prisma.integrationAccount.findFirst({
    where: {
      id: input.integrationAccountId,
      agentProfileId: input.actor.agentProfileId,
      agentProfile: {
        userId: input.actor.userId,
      },
      providerType: IntegrationProviderType.WEBHOOK,
    },
    select: {
      id: true,
      externalAccountId: true,
      replayCursor: true,
      status: true,
    },
  });

  if (!integrationAccount) {
    throw new NotFoundError("Webhook integration account not found.");
  }

  if (integrationAccount.status !== "ACTIVE") {
    throw new ForbiddenError(
      "The selected webhook integration account is not active.",
    );
  }

  if (
    requestData.path &&
    (!requestData.path.startsWith("/") || requestData.path.startsWith("//"))
  ) {
    throw new BadRequestError(
      "Webhook paths must be same-origin absolute paths beginning with one slash.",
    );
  }

  const targetUrl = requestData.path
    ? new URL(requestData.path, integrationAccount.externalAccountId).toString()
    : integrationAccount.externalAccountId;

  const urlValidation = validateUrlForSsrf(targetUrl);
  if (!urlValidation.valid) {
    throw new BadRequestError(
      urlValidation.error || "Invalid outbound webhook target.",
    );
  }

  const signingSecret = getWebhookSigningSecret(
    integrationAccount.replayCursor,
  );
  const baseMetadata = {
    integrationAccountId: integrationAccount.id,
    request: requestData,
    ...(input.metadata && typeof input.metadata === "object"
      ? (input.metadata as Record<string, unknown>)
      : {}),
  };

  const agentAction = await prisma.agentAction.create({
    data: {
      userId: input.actor.userId,
      agentProfileId: input.actor.agentProfileId,
      integrationAccountId:
        input.actor.integrationAccountId ?? integrationAccount.id,
      modelCredentialId: input.actor.modelCredentialId ?? null,
      kind: AgentActionKind.EXECUTE_EXTERNAL,
      rung: AGENT_CAPABILITY_RUNGS.EXECUTE_EXTERNAL,
      status: AgentActionStatus.RUNNING,
      summary: input.summary,
      requestFingerprint: buildRequestFingerprint({
        integrationAccountId: integrationAccount.id,
        request: requestData,
        summary: input.summary,
      }),
      metadata: toJsonValue(baseMetadata),
    },
  });

  try {
    const delivery = await deliverSignedWebhook({
      url: targetUrl,
      secret: signingSecret,
      method: requestData.method,
      headers: requestData.headers,
      body: requestData.body,
    });

    const replayCursor = normalizeReplayCursor(integrationAccount.replayCursor);
    replayCursor.lastOutboundDeliveryId = delivery.deliveryId;
    replayCursor.lastOutboundDeliveryAt = new Date().toISOString();
    replayCursor.lastOutboundStatus = delivery.status;

    await prisma.integrationAccount.update({
      where: { id: integrationAccount.id },
      data: {
        lastSeenAt: new Date(),
        replayCursor: toJsonValue(replayCursor),
      },
    });

    if (!delivery.ok) {
      await prisma.agentAction.update({
        where: { id: agentAction.id },
        data: {
          status: AgentActionStatus.FAILED,
          metadata: toJsonValue({
            ...baseMetadata,
            delivery,
          }),
        },
      });

      throw new BadRequestError(
        `Webhook delivery failed with status ${delivery.status}.`,
      );
    }

    await prisma.agentAction.update({
      where: { id: agentAction.id },
      data: {
        status: AgentActionStatus.COMPLETED,
        metadata: toJsonValue({
          ...baseMetadata,
          delivery,
        }),
      },
    });

    return {
      agentActionId: agentAction.id,
      delivery,
    };
  } catch (error) {
    await prisma.agentAction.update({
      where: { id: agentAction.id },
      data: {
        status: AgentActionStatus.FAILED,
        metadata: toJsonValue({
          ...baseMetadata,
          error:
            error instanceof Error
              ? error.message
              : "Unknown webhook delivery error",
        }),
      },
    });

    throw error;
  }
}

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
    changeRecord.operation === "CREATE"
  ) {
    const existing = await tx.canvasItem.findUnique({
      where: { id: changeRecord.targetId },
    });
    if (existing && existing.deletedAt === null) {
      const deletedAt = new Date();
      await tx.canvasItem.update({
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

    await tx.canvasItem.update({
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
