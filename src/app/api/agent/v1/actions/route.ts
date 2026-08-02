import { type NextRequest, NextResponse } from "next/server";
import {
  IntegrationProviderType,
  SuggestionKind,
} from "@/generated/prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApiHandler } from "@/lib/api/route-handler";
import { parsePagination } from "@/lib/api/pagination";
import {
  getOwnedAgentProfile,
  resolveAgentRequestContext,
} from "@/lib/agents/auth";
import { assertAgentCapability, assertCanvasScope } from "@/lib/agents/policy";
import { AGENT_CAPABILITY_RUNGS } from "@/lib/agents/constants";
import {
  approveSuggestion,
  claimSuggestionForExecution,
  createCanvasItemBatchWrite,
  createCanvasItemWrite,
  createKnowledgeEntityWrite,
  createKnowledgeRelationWrite,
  createSuggestionRecord,
  createWorkspaceCheckpoint,
  executeExternalWebhook,
  markSuggestionExecuted,
  normalizeAgentItemWriteBatch,
  normalizeAgentItemWriteData,
  rejectSuggestion,
  revertChangeSet,
} from "@/lib/agents/service-core";
import {
  listScopedActionTimeline,
  requireScopedKnowledgeEntity,
} from "@/lib/agents/query-core";
import {
  KNOWLEDGE_ENTITY_SUGGESTION_KIND,
  KNOWLEDGE_RELATION_SUGGESTION_KIND,
  knowledgeEntitySuggestionPayloadSchema,
  knowledgeRelationSuggestionPayloadSchema,
} from "@/lib/agents/knowledge-schemas";
import { ForbiddenError, NotFoundError, BadRequestError } from "@/lib/errors";

const headerValueSchema = z.string().min(1).max(2000);
const externalActionPayloadSchema = z.object({
  kind: z.literal("external-webhook"),
  integrationAccountId: z.string().cuid(),
  request: z.object({
    method: z.enum(["POST", "PUT", "PATCH"]).default("POST"),
    path: z.string().min(1).max(2048).optional(),
    headers: z.record(z.string(), headerValueSchema).default({}),
    body: z.unknown(),
  }),
  compensatingAction: z.record(z.string(), z.unknown()).optional(),
});

const createCheckpointSchema = z.object({
  canvasId: z.string().cuid(),
  reason: z.string().min(1).max(255),
});

async function verifyCanvasOwnership(userId: string, canvasId: string) {
  const canvas = await prisma.canvas.findFirst({
    where: {
      id: canvasId,
      userId,
    },
    select: { id: true },
  });

  if (!canvas) {
    throw new NotFoundError("Canvas not found.");
  }
}

async function getItemCanvasScope(userId: string, itemId: string) {
  const item = await prisma.canvasItem.findFirst({
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

async function getOwnedIntegrationAccount(
  userId: string,
  integrationAccountId: string,
  agentProfileId?: string,
) {
  const integrationAccount = await prisma.integrationAccount.findFirst({
    where: {
      id: integrationAccountId,
      ...(agentProfileId ? { agentProfileId } : {}),
      agentProfile: {
        userId,
      },
    },
    select: {
      id: true,
      agentProfileId: true,
      providerType: true,
      status: true,
    },
  });

  if (!integrationAccount) {
    throw new NotFoundError("Integration account not found.");
  }

  return integrationAccount;
}

async function getOwnedSuggestion(userId: string, suggestionId: string) {
  const suggestion = await prisma.suggestion.findFirst({
    where: {
      id: suggestionId,
      userId,
    },
    select: {
      id: true,
      agentProfileId: true,
      kind: true,
      status: true,
      summary: true,
      payload: true,
      expiresAt: true,
    },
  });

  if (!suggestion) {
    throw new NotFoundError("Suggestion not found.");
  }

  return suggestion;
}

async function resolveRequiredAgentProfile(
  request: NextRequest,
  input?: {
    suggestionId?: string;
    changeSetId?: string;
  },
) {
  const context = await resolveAgentRequestContext(request);

  if (context.agentProfile) {
    return {
      context,
      agentProfile: context.agentProfile,
    };
  }

  if (context.actorType !== "user") {
    throw new ForbiddenError(
      "Agent profile context is required for this action.",
    );
  }

  if (input?.suggestionId) {
    const suggestion = await getOwnedSuggestion(
      context.userId,
      input.suggestionId,
    );
    if (!suggestion.agentProfileId) {
      throw new BadRequestError(
        "The selected suggestion is not attached to an agent profile.",
      );
    }

    const agentProfile = await getOwnedAgentProfile(
      context.userId,
      suggestion.agentProfileId,
    );
    return { context, agentProfile, suggestion };
  }

  if (input?.changeSetId) {
    const changeSet = await prisma.changeSet.findFirst({
      where: {
        id: input.changeSetId,
        userId: context.userId,
      },
      select: {
        id: true,
        agentProfileId: true,
      },
    });

    if (!changeSet) {
      throw new NotFoundError("Change set not found.");
    }

    const agentProfile = await getOwnedAgentProfile(
      context.userId,
      changeSet.agentProfileId,
    );
    return { context, agentProfile };
  }

  throw new BadRequestError("agentProfileId is required for this endpoint.");
}

export const GET = withApiHandler(async (request: NextRequest) => {
  const context = await resolveAgentRequestContext(request);

  const { limit } = parsePagination(request.nextUrl.searchParams, {
    defaultLimit: 50,
    maxLimit: 100,
  });

  return NextResponse.json(
    await listScopedActionTimeline(context, {
      limit,
    }),
  );
});

export const POST = withApiHandler(async (request: NextRequest) => {
  const body = await request.json();
  const action = typeof body?.action === "string" ? body.action : null;

  if (action === "approve-suggestion" || action === "reject-suggestion") {
    const context = await resolveAgentRequestContext(request);
    if (context.actorType !== "user") {
      throw new ForbiddenError(
        "Integration tokens cannot approve or reject suggestions.",
      );
    }

    const data = z
      .object({
        action: z.enum(["approve-suggestion", "reject-suggestion"]),
        suggestionId: z.string().cuid(),
      })
      .parse(body);

    const suggestion =
      data.action === "approve-suggestion"
        ? await approveSuggestion({
            userId: context.userId,
            suggestionId: data.suggestionId,
          })
        : await rejectSuggestion({
            userId: context.userId,
            suggestionId: data.suggestionId,
          });

    return NextResponse.json({ suggestion }, { status: 200 });
  }

  if (action === "propose-external") {
    const { context, agentProfile } =
      await resolveRequiredAgentProfile(request);
    const data = z
      .object({
        action: z.literal("propose-external"),
        summary: z.string().min(1).max(255),
        payload: externalActionPayloadSchema,
      })
      .parse(body);

    const integrationAccount = await getOwnedIntegrationAccount(
      context.userId,
      data.payload.integrationAccountId,
      agentProfile.id,
    );

    if (integrationAccount.providerType !== IntegrationProviderType.WEBHOOK) {
      throw new BadRequestError(
        "Only WEBHOOK external actions are implemented in this slice.",
      );
    }

    assertAgentCapability(
      agentProfile,
      AGENT_CAPABILITY_RUNGS.PROPOSE_EXTERNAL,
    );

    const result = await createSuggestionRecord({
      actor: {
        userId: context.userId,
        agentProfileId: agentProfile.id,
        integrationAccountId: context.integrationAccountId,
        modelCredentialId: agentProfile.defaultModelCredentialId,
      },
      kind: SuggestionKind.EXTERNAL_ACTION,
      summary: data.summary,
      payload: data.payload,
      rung: AGENT_CAPABILITY_RUNGS.PROPOSE_EXTERNAL,
    });

    return NextResponse.json(result, { status: 201 });
  }

  if (action === "revert-change-set") {
    const data = z
      .object({
        action: z.literal("revert-change-set"),
        changeSetId: z.string().cuid(),
      })
      .parse(body);
    const { context, agentProfile } = await resolveRequiredAgentProfile(
      request,
      {
        changeSetId: data.changeSetId,
      },
    );

    assertAgentCapability(agentProfile, AGENT_CAPABILITY_RUNGS.WRITE_SINGLE);

    const result = await revertChangeSet({
      actor: {
        userId: context.userId,
        agentProfileId: agentProfile.id,
        integrationAccountId: context.integrationAccountId,
        modelCredentialId: agentProfile.defaultModelCredentialId,
      },
      changeSetId: data.changeSetId,
    });

    return NextResponse.json(result, { status: 200 });
  }

  if (action === "create-checkpoint") {
    const { context, agentProfile } =
      await resolveRequiredAgentProfile(request);
    const data = z
      .object({
        action: z.literal("create-checkpoint"),
      })
      .merge(createCheckpointSchema)
      .parse(body);

    await verifyCanvasOwnership(context.userId, data.canvasId);
    assertCanvasScope(agentProfile, data.canvasId);
    assertAgentCapability(agentProfile, AGENT_CAPABILITY_RUNGS.BULK);

    const checkpoint = await createWorkspaceCheckpoint({
      actor: {
        userId: context.userId,
        agentProfileId: agentProfile.id,
        integrationAccountId: context.integrationAccountId,
        modelCredentialId: agentProfile.defaultModelCredentialId,
      },
      canvasId: data.canvasId,
      reason: data.reason,
    });

    return NextResponse.json({ checkpoint }, { status: 201 });
  }

  if (action === "execute-suggestion") {
    const data = z
      .object({
        action: z.literal("execute-suggestion"),
        suggestionId: z.string().cuid(),
      })
      .parse(body);
    const resolved = await resolveRequiredAgentProfile(request, {
      suggestionId: data.suggestionId,
    });
    const context = resolved.context;
    const agentProfile = resolved.agentProfile;
    const suggestion =
      resolved.suggestion ||
      (await getOwnedSuggestion(context.userId, data.suggestionId));

    if (suggestion.status !== "APPROVED") {
      throw new BadRequestError("Only approved suggestions can be executed.");
    }

    if (suggestion.expiresAt <= new Date()) {
      throw new BadRequestError("The selected suggestion has expired.");
    }

    await claimSuggestionForExecution({
      userId: context.userId,
      suggestionId: suggestion.id,
    });

    const actor = {
      userId: context.userId,
      agentProfileId: agentProfile.id,
      integrationAccountId: context.integrationAccountId,
      modelCredentialId: agentProfile.defaultModelCredentialId,
    };

    const payload = suggestion.payload as Record<string, unknown>;
    const payloadKind = typeof payload.kind === "string" ? payload.kind : null;

    if (payloadKind === "canvas-item-create") {
      const parsed = z
        .object({
          kind: z.literal("canvas-item-create"),
          canvasId: z.string().cuid(),
          item: z.unknown(),
        })
        .parse(payload);
      const normalizedItem = normalizeAgentItemWriteData(parsed.item);

      await verifyCanvasOwnership(context.userId, parsed.canvasId);
      assertCanvasScope(agentProfile, parsed.canvasId);
      assertAgentCapability(agentProfile, AGENT_CAPABILITY_RUNGS.WRITE_SINGLE);

      const result = await createCanvasItemWrite({
        actor,
        canvasId: parsed.canvasId,
        itemData: normalizedItem,
        summary: suggestion.summary,
      });

      await markSuggestionExecuted({
        userId: context.userId,
        suggestionId: suggestion.id,
      });

      return NextResponse.json(
        {
          suggestionId: suggestion.id,
          executed: result,
        },
        { status: 200 },
      );
    }

    if (payloadKind === KNOWLEDGE_ENTITY_SUGGESTION_KIND) {
      const parsed = knowledgeEntitySuggestionPayloadSchema.parse(payload);
      const item = await getItemCanvasScope(context.userId, parsed.itemId);

      assertCanvasScope(agentProfile, item.canvasId);
      assertAgentCapability(agentProfile, AGENT_CAPABILITY_RUNGS.WRITE_SINGLE);

      const result = await createKnowledgeEntityWrite({
        actor,
        itemId: parsed.itemId,
        entityType: parsed.entityType,
        title: parsed.title,
        summary: parsed.summary,
        attributes: parsed.attributes,
        sourceConfidence: parsed.sourceConfidence,
      });

      await markSuggestionExecuted({
        userId: context.userId,
        suggestionId: suggestion.id,
      });

      return NextResponse.json(
        {
          suggestionId: suggestion.id,
          executed: result,
        },
        { status: 200 },
      );
    }

    if (payloadKind === KNOWLEDGE_RELATION_SUGGESTION_KIND) {
      const parsed = knowledgeRelationSuggestionPayloadSchema.parse(payload);
      const sourceEntity = await requireScopedKnowledgeEntity(
        { userId: context.userId, agentProfile },
        parsed.sourceEntityId,
      );
      const targetEntity = await requireScopedKnowledgeEntity(
        { userId: context.userId, agentProfile },
        parsed.targetEntityId,
      );
      const sharedCanvasId = sourceEntity.canvasIds.find((canvasId) =>
        targetEntity.canvasIds.includes(canvasId),
      );

      if (!sharedCanvasId) {
        throw new BadRequestError(
          "Knowledge relations must remain inside one shared canvas.",
        );
      }

      assertCanvasScope(agentProfile, sharedCanvasId);
      assertAgentCapability(agentProfile, AGENT_CAPABILITY_RUNGS.WRITE_SINGLE);

      const result = await createKnowledgeRelationWrite({
        actor,
        sourceEntityId: parsed.sourceEntityId,
        targetEntityId: parsed.targetEntityId,
        relationType: parsed.relationType,
        summary: parsed.summary,
        attributes: parsed.attributes,
        confidence: parsed.confidence,
      });

      await markSuggestionExecuted({
        userId: context.userId,
        suggestionId: suggestion.id,
      });

      return NextResponse.json(
        {
          suggestionId: suggestion.id,
          executed: result,
        },
        { status: 200 },
      );
    }

    if (payloadKind === "canvas-item-batch-create") {
      const parsed = z
        .object({
          kind: z.literal("canvas-item-batch-create"),
          canvasId: z.string().cuid(),
          items: z.array(z.unknown()).min(1),
          executionMode: z.enum(["group", "bulk"]).default("group"),
          checkpointId: z.string().cuid().optional(),
        })
        .parse(payload);
      const normalizedItems = normalizeAgentItemWriteBatch(parsed.items);
      const rung =
        parsed.executionMode === "bulk"
          ? AGENT_CAPABILITY_RUNGS.BULK
          : AGENT_CAPABILITY_RUNGS.WRITE_GROUP;

      await verifyCanvasOwnership(context.userId, parsed.canvasId);
      assertCanvasScope(agentProfile, parsed.canvasId);
      assertAgentCapability(agentProfile, rung);

      const result = await createCanvasItemBatchWrite({
        actor,
        canvasId: parsed.canvasId,
        items: normalizedItems,
        summary: suggestion.summary,
        rung,
        checkpointId:
          parsed.executionMode === "bulk" ? parsed.checkpointId : null,
        checkpointReason: suggestion.summary,
      });

      await markSuggestionExecuted({
        userId: context.userId,
        suggestionId: suggestion.id,
      });

      return NextResponse.json(
        {
          suggestionId: suggestion.id,
          executed: result,
        },
        { status: 200 },
      );
    }

    if (payloadKind === "external-webhook") {
      const parsed = externalActionPayloadSchema.parse(payload);

      await getOwnedIntegrationAccount(
        context.userId,
        parsed.integrationAccountId,
        agentProfile.id,
      );
      assertAgentCapability(
        agentProfile,
        AGENT_CAPABILITY_RUNGS.EXECUTE_EXTERNAL,
      );

      const result = await executeExternalWebhook({
        actor,
        integrationAccountId: parsed.integrationAccountId,
        summary: suggestion.summary,
        request: parsed.request,
        metadata: {
          suggestionId: suggestion.id,
          compensatingAction: parsed.compensatingAction,
        },
      });

      await markSuggestionExecuted({
        userId: context.userId,
        suggestionId: suggestion.id,
      });

      return NextResponse.json(
        {
          suggestionId: suggestion.id,
          executed: result,
        },
        { status: 200 },
      );
    }

    throw new BadRequestError("Unsupported suggestion payload.");
  }

  return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
});
