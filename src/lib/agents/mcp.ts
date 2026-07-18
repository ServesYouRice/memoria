import { IntegrationProviderType, SuggestionKind } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { AgentRequestContext } from "@/lib/agents/auth";
import { getOwnedAgentProfile } from "@/lib/agents/auth";
import { AGENT_CAPABILITY_RUNGS } from "@/lib/agents/constants";
import type { McpToolCallResult } from "@/lib/agents/mcp-schema";
export {
  buildMcpInitializeResult,
  listMcpTools,
} from "@/lib/agents/mcp-schema";
import { assertAgentCapability, assertCanvasScope } from "@/lib/agents/policy";
import {
  listOwnedIntegrationAccounts,
  listOwnedProviderCredentials,
  listScopedActionTimeline,
  listScopedCanvasItems,
  listScopedCanvases,
  listScopedKnowledgeEntities,
  requireScopedCanvas,
  requireScopedKnowledgeEntity,
  requireScopedItem,
} from "@/lib/agents/query-core";

const mcpLimitSchema = z.coerce.number().int().min(1).max(100).default(50);
const mcpOffsetSchema = z.coerce
  .number()
  .int()
  .min(0)
  .max(1_000_000)
  .default(0);
import {
  approveSuggestion,
  claimSuggestionForExecution,
  createBulkCanvasItemSuggestion,
  createCanvasItemBatchWrite,
  createCanvasItemComment,
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
  KNOWLEDGE_ENTITY_SUGGESTION_KIND,
  KNOWLEDGE_RELATION_SUGGESTION_KIND,
  knowledgeEntitySuggestionPayloadSchema,
  knowledgeRelationSuggestionPayloadSchema,
} from "@/lib/agents/knowledge-schemas";
import { BadRequestError, ForbiddenError, NotFoundError } from "@/lib/errors";

function createTextResult(payload: unknown): McpToolCallResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
  };
}

async function resolveAgentProfileForWrite(
  context: AgentRequestContext,
  args: {
    agentProfileId?: string;
    suggestionId?: string;
    changeSetId?: string;
  },
) {
  if (context.agentProfile) {
    return context.agentProfile;
  }

  if (args.agentProfileId) {
    return getOwnedAgentProfile(context.userId, args.agentProfileId);
  }

  if (args.suggestionId) {
    const suggestion = await prisma.suggestion.findFirst({
      where: {
        id: args.suggestionId,
        userId: context.userId,
      },
      select: {
        agentProfileId: true,
      },
    });

    if (suggestion?.agentProfileId) {
      return getOwnedAgentProfile(context.userId, suggestion.agentProfileId);
    }
  }

  if (args.changeSetId) {
    const changeSet = await prisma.changeSet.findFirst({
      where: {
        id: args.changeSetId,
        userId: context.userId,
      },
      select: {
        agentProfileId: true,
      },
    });

    if (changeSet?.agentProfileId) {
      return getOwnedAgentProfile(context.userId, changeSet.agentProfileId);
    }
  }

  throw new BadRequestError(
    "agentProfileId is required for MCP write tools when using a user session without x-agent-profile-id.",
  );
}

async function resolveWriteActor(
  context: AgentRequestContext,
  args: {
    agentProfileId?: string;
    suggestionId?: string;
    changeSetId?: string;
  },
) {
  const agentProfile = await resolveAgentProfileForWrite(context, args);

  return {
    actor: {
      userId: context.userId,
      agentProfileId: agentProfile.id,
      integrationAccountId: context.integrationAccountId,
      modelCredentialId: agentProfile.defaultModelCredentialId,
    },
    agentProfile,
  };
}

function getObjectArgument(args: unknown) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new BadRequestError("MCP tool arguments must be a JSON object.");
  }

  return args as Record<string, unknown>;
}

async function executeApprovedSuggestion(
  context: AgentRequestContext,
  args: Record<string, unknown>,
) {
  const suggestionId = String(args.suggestionId || "");
  if (!suggestionId) {
    throw new BadRequestError("suggestionId is required.");
  }

  const suggestion = await prisma.suggestion.findFirst({
    where: {
      id: suggestionId,
      userId: context.userId,
    },
    select: {
      id: true,
      status: true,
      summary: true,
      payload: true,
      expiresAt: true,
      agentProfileId: true,
    },
  });

  if (!suggestion) {
    throw new NotFoundError("Suggestion not found.");
  }

  if (suggestion.status !== "APPROVED") {
    throw new BadRequestError("Only approved suggestions can be executed.");
  }

  if (suggestion.expiresAt <= new Date()) {
    throw new BadRequestError("The selected suggestion has expired.");
  }

  await claimSuggestionForExecution({
    userId: context.userId,
    suggestionId,
  });

  const { actor, agentProfile } = await resolveWriteActor(context, {
    agentProfileId:
      typeof args.agentProfileId === "string" ? args.agentProfileId : undefined,
    suggestionId,
  });

  const payload = suggestion.payload as Record<string, unknown>;
  const payloadKind = typeof payload.kind === "string" ? payload.kind : null;

  if (payloadKind === "canvas-item-create") {
    const canvasId = String(payload.canvasId || "");
    const item = normalizeAgentItemWriteData(payload.item);
    await requireScopedCanvas(
      { userId: context.userId, agentProfile },
      canvasId,
    );
    assertAgentCapability(agentProfile, AGENT_CAPABILITY_RUNGS.WRITE_SINGLE);
    const result = await createCanvasItemWrite({
      actor,
      canvasId,
      itemData: item,
      summary: suggestion.summary,
    });
    await markSuggestionExecuted({ userId: context.userId, suggestionId });
    return { suggestionId, executed: result };
  }

  if (payloadKind === "canvas-item-batch-create") {
    const canvasId = String(payload.canvasId || "");
    const items = normalizeAgentItemWriteBatch(
      Array.isArray(payload.items) ? payload.items : [],
    );
    const executionMode = payload.executionMode === "bulk" ? "bulk" : "group";
    const rung =
      executionMode === "bulk"
        ? AGENT_CAPABILITY_RUNGS.BULK
        : AGENT_CAPABILITY_RUNGS.WRITE_GROUP;
    await requireScopedCanvas(
      { userId: context.userId, agentProfile },
      canvasId,
    );
    assertAgentCapability(agentProfile, rung);
    const result = await createCanvasItemBatchWrite({
      actor,
      canvasId,
      items,
      summary: suggestion.summary,
      rung,
      checkpointId:
        executionMode === "bulk" && typeof payload.checkpointId === "string"
          ? payload.checkpointId
          : null,
      checkpointReason: suggestion.summary,
    });
    await markSuggestionExecuted({ userId: context.userId, suggestionId });
    return { suggestionId, executed: result };
  }

  if (payloadKind === KNOWLEDGE_ENTITY_SUGGESTION_KIND) {
    const parsed = knowledgeEntitySuggestionPayloadSchema.parse(payload);
    const item = await requireScopedItem(
      { userId: context.userId, agentProfile },
      parsed.itemId,
    );
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
    await markSuggestionExecuted({ userId: context.userId, suggestionId });
    return { suggestionId, executed: result };
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
    await markSuggestionExecuted({ userId: context.userId, suggestionId });
    return { suggestionId, executed: result };
  }

  if (payloadKind === "external-webhook") {
    const integrationAccountId = String(payload.integrationAccountId || "");
    assertAgentCapability(
      agentProfile,
      AGENT_CAPABILITY_RUNGS.EXECUTE_EXTERNAL,
    );
    const result = await executeExternalWebhook({
      actor,
      integrationAccountId,
      summary: suggestion.summary,
      request: payload.request,
      metadata: {
        suggestionId,
        compensatingAction:
          payload.compensatingAction &&
          typeof payload.compensatingAction === "object"
            ? payload.compensatingAction
            : undefined,
      },
    });
    await markSuggestionExecuted({ userId: context.userId, suggestionId });
    return { suggestionId, executed: result };
  }

  throw new BadRequestError("Unsupported suggestion payload.");
}

export async function executeMcpTool(
  context: AgentRequestContext,
  toolName: string,
  rawArgs: unknown,
) {
  const args = getObjectArgument(rawArgs);

  switch (toolName) {
    case "canvases.list": {
      const limit = mcpLimitSchema.parse(args.limit);
      const offset = mcpOffsetSchema.parse(args.offset);
      return createTextResult(
        await listScopedCanvases(context, { limit, offset }),
      );
    }
    case "canvases.get": {
      const canvasId = String(args.canvasId || "");
      const canvas = await requireScopedCanvas(context, canvasId);
      return createTextResult({ canvas });
    }
    case "items.list": {
      const canvasId = String(args.canvasId || "");
      return createTextResult({
        items: await listScopedCanvasItems(context, canvasId),
      });
    }
    case "items.create": {
      const canvasId = String(args.canvasId || "");
      const { actor, agentProfile } = await resolveWriteActor(context, {
        agentProfileId:
          typeof args.agentProfileId === "string"
            ? args.agentProfileId
            : undefined,
      });
      await requireScopedCanvas(
        { userId: context.userId, agentProfile },
        canvasId,
      );
      assertAgentCapability(agentProfile, AGENT_CAPABILITY_RUNGS.WRITE_SINGLE);
      return createTextResult(
        await createCanvasItemWrite({
          actor,
          canvasId,
          itemData: normalizeAgentItemWriteData(args.item),
          summary:
            typeof args.summary === "string"
              ? args.summary
              : `Create item on canvas ${canvasId}`,
        }),
      );
    }
    case "items.propose_create": {
      const canvasId = String(args.canvasId || "");
      const { actor, agentProfile } = await resolveWriteActor(context, {
        agentProfileId:
          typeof args.agentProfileId === "string"
            ? args.agentProfileId
            : undefined,
      });
      await requireScopedCanvas(
        { userId: context.userId, agentProfile },
        canvasId,
      );
      assertAgentCapability(agentProfile, AGENT_CAPABILITY_RUNGS.PROPOSE);
      const item = normalizeAgentItemWriteData(args.item);
      return createTextResult(
        await createSuggestionRecord({
          actor,
          kind: SuggestionKind.INTERNAL_ORGANIZATION,
          summary:
            typeof args.summary === "string"
              ? args.summary
              : `Propose ${item.type.toLowerCase()} creation on canvas ${canvasId}`,
          payload: {
            kind: "canvas-item-create",
            canvasId,
            item,
          },
          rung: AGENT_CAPABILITY_RUNGS.PROPOSE,
        }),
      );
    }
    case "items.comment": {
      const itemId = String(args.itemId || "");
      const { actor, agentProfile } = await resolveWriteActor(context, {
        agentProfileId:
          typeof args.agentProfileId === "string"
            ? args.agentProfileId
            : undefined,
      });
      const item = await requireScopedItem(
        { userId: context.userId, agentProfile },
        itemId,
      );
      assertCanvasScope(agentProfile, item.canvasId);
      assertAgentCapability(agentProfile, AGENT_CAPABILITY_RUNGS.COMMENT);
      return createTextResult(
        await createCanvasItemComment({
          actor,
          itemId,
          content: String(args.content || ""),
          summary:
            typeof args.summary === "string"
              ? args.summary
              : `Comment on item ${itemId}`,
        }),
      );
    }
    case "items.create_batch": {
      const canvasId = String(args.canvasId || "");
      const items = normalizeAgentItemWriteBatch(
        Array.isArray(args.items) ? args.items : [],
      );
      const { actor, agentProfile } = await resolveWriteActor(context, {
        agentProfileId:
          typeof args.agentProfileId === "string"
            ? args.agentProfileId
            : undefined,
      });
      await requireScopedCanvas(
        { userId: context.userId, agentProfile },
        canvasId,
      );
      assertAgentCapability(agentProfile, AGENT_CAPABILITY_RUNGS.WRITE_GROUP);
      return createTextResult(
        await createCanvasItemBatchWrite({
          actor,
          canvasId,
          items,
          summary:
            typeof args.summary === "string"
              ? args.summary
              : `Create ${items.length} items on canvas ${canvasId}`,
          rung: AGENT_CAPABILITY_RUNGS.WRITE_GROUP,
        }),
      );
    }
    case "items.preview_bulk_create": {
      const canvasId = String(args.canvasId || "");
      const items = normalizeAgentItemWriteBatch(
        Array.isArray(args.items) ? args.items : [],
      );
      const { actor, agentProfile } = await resolveWriteActor(context, {
        agentProfileId:
          typeof args.agentProfileId === "string"
            ? args.agentProfileId
            : undefined,
      });
      await requireScopedCanvas(
        { userId: context.userId, agentProfile },
        canvasId,
      );
      assertAgentCapability(agentProfile, AGENT_CAPABILITY_RUNGS.BULK);
      return createTextResult(
        await createBulkCanvasItemSuggestion({
          actor,
          canvasId,
          items,
          summary:
            typeof args.summary === "string"
              ? args.summary
              : `Preview bulk create of ${items.length} items on canvas ${canvasId}`,
          checkpointReason:
            typeof args.checkpointReason === "string"
              ? args.checkpointReason
              : typeof args.summary === "string"
                ? args.summary
                : `Bulk preview before creating ${items.length} items`,
        }),
      );
    }
    case "knowledge.list": {
      return createTextResult(
        await listScopedKnowledgeEntities(context, {
          canvasId:
            typeof args.canvasId === "string" ? args.canvasId : undefined,
          itemId: typeof args.itemId === "string" ? args.itemId : undefined,
        }),
      );
    }
    case "knowledge.create": {
      const parsed = knowledgeEntitySuggestionPayloadSchema.parse({
        kind: KNOWLEDGE_ENTITY_SUGGESTION_KIND,
        ...args,
      });
      const { actor, agentProfile } = await resolveWriteActor(context, {
        agentProfileId:
          typeof args.agentProfileId === "string"
            ? args.agentProfileId
            : undefined,
      });
      const item = await requireScopedItem(
        { userId: context.userId, agentProfile },
        parsed.itemId,
      );
      assertCanvasScope(agentProfile, item.canvasId);
      assertAgentCapability(agentProfile, AGENT_CAPABILITY_RUNGS.WRITE_SINGLE);
      return createTextResult(
        await createKnowledgeEntityWrite({
          actor,
          itemId: parsed.itemId,
          entityType: parsed.entityType,
          title: parsed.title,
          summary: parsed.summary,
          attributes: parsed.attributes,
          sourceConfidence: parsed.sourceConfidence,
        }),
      );
    }
    case "knowledge.create_relation": {
      const parsed = knowledgeRelationSuggestionPayloadSchema.parse({
        kind: KNOWLEDGE_RELATION_SUGGESTION_KIND,
        ...args,
      });
      const { actor, agentProfile } = await resolveWriteActor(context, {
        agentProfileId:
          typeof args.agentProfileId === "string"
            ? args.agentProfileId
            : undefined,
      });
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
      return createTextResult(
        await createKnowledgeRelationWrite({
          actor,
          sourceEntityId: parsed.sourceEntityId,
          targetEntityId: parsed.targetEntityId,
          relationType: parsed.relationType,
          summary: parsed.summary,
          attributes: parsed.attributes,
          confidence: parsed.confidence,
        }),
      );
    }
    case "knowledge.propose_create": {
      const parsed = knowledgeEntitySuggestionPayloadSchema.parse({
        kind: KNOWLEDGE_ENTITY_SUGGESTION_KIND,
        ...args,
      });
      const { actor, agentProfile } = await resolveWriteActor(context, {
        agentProfileId:
          typeof args.agentProfileId === "string"
            ? args.agentProfileId
            : undefined,
      });
      const item = await requireScopedItem(
        { userId: context.userId, agentProfile },
        parsed.itemId,
      );
      assertCanvasScope(agentProfile, item.canvasId);
      assertAgentCapability(agentProfile, AGENT_CAPABILITY_RUNGS.PROPOSE);
      return createTextResult(
        await createSuggestionRecord({
          actor,
          kind: SuggestionKind.INTERNAL_ORGANIZATION,
          summary:
            typeof args.summary === "string"
              ? args.summary
              : `Propose knowledge entity ${parsed.title}`,
          payload: {
            kind: KNOWLEDGE_ENTITY_SUGGESTION_KIND,
            itemId: parsed.itemId,
            entityType: parsed.entityType,
            title: parsed.title,
            summary:
              typeof args.summary === "string" ? args.summary : parsed.summary,
            attributes: parsed.attributes,
            sourceConfidence: parsed.sourceConfidence,
          },
          rung: AGENT_CAPABILITY_RUNGS.PROPOSE,
        }),
      );
    }
    case "knowledge.propose_relation": {
      const parsed = knowledgeRelationSuggestionPayloadSchema.parse({
        kind: KNOWLEDGE_RELATION_SUGGESTION_KIND,
        ...args,
      });
      const { actor, agentProfile } = await resolveWriteActor(context, {
        agentProfileId:
          typeof args.agentProfileId === "string"
            ? args.agentProfileId
            : undefined,
      });
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
      assertAgentCapability(agentProfile, AGENT_CAPABILITY_RUNGS.PROPOSE);
      return createTextResult(
        await createSuggestionRecord({
          actor,
          kind: SuggestionKind.INTERNAL_ORGANIZATION,
          summary:
            typeof args.summary === "string"
              ? args.summary
              : `Propose knowledge relation ${parsed.relationType}`,
          payload: {
            kind: KNOWLEDGE_RELATION_SUGGESTION_KIND,
            sourceEntityId: parsed.sourceEntityId,
            targetEntityId: parsed.targetEntityId,
            relationType: parsed.relationType,
            summary:
              typeof args.summary === "string" ? args.summary : parsed.summary,
            attributes: parsed.attributes,
            confidence: parsed.confidence,
          },
          rung: AGENT_CAPABILITY_RUNGS.PROPOSE,
        }),
      );
    }
    case "actions.list": {
      const limit = mcpLimitSchema.parse(args.limit);
      return createTextResult(
        await listScopedActionTimeline(context, { limit }),
      );
    }
    case "actions.approve_suggestion": {
      return createTextResult(
        await approveSuggestion({
          userId: context.userId,
          suggestionId: String(args.suggestionId || ""),
        }),
      );
    }
    case "actions.reject_suggestion": {
      return createTextResult(
        await rejectSuggestion({
          userId: context.userId,
          suggestionId: String(args.suggestionId || ""),
        }),
      );
    }
    case "actions.execute_suggestion": {
      return createTextResult(await executeApprovedSuggestion(context, args));
    }
    case "actions.revert_change_set": {
      const changeSetId = String(args.changeSetId || "");
      const { actor, agentProfile } = await resolveWriteActor(context, {
        agentProfileId:
          typeof args.agentProfileId === "string"
            ? args.agentProfileId
            : undefined,
        changeSetId,
      });
      assertAgentCapability(agentProfile, AGENT_CAPABILITY_RUNGS.WRITE_SINGLE);
      return createTextResult(await revertChangeSet({ actor, changeSetId }));
    }
    case "actions.create_checkpoint": {
      const canvasId = String(args.canvasId || "");
      const { actor, agentProfile } = await resolveWriteActor(context, {
        agentProfileId:
          typeof args.agentProfileId === "string"
            ? args.agentProfileId
            : undefined,
      });
      await requireScopedCanvas(
        { userId: context.userId, agentProfile },
        canvasId,
      );
      assertAgentCapability(agentProfile, AGENT_CAPABILITY_RUNGS.BULK);
      return createTextResult(
        await createWorkspaceCheckpoint({
          actor,
          canvasId,
          reason: String(args.reason || ""),
        }),
      );
    }
    case "actions.propose_external": {
      const payload =
        args.payload && typeof args.payload === "object"
          ? (args.payload as Record<string, unknown>)
          : null;
      if (!payload) {
        throw new BadRequestError("payload is required.");
      }

      const integrationAccountId = String(payload.integrationAccountId || "");
      const { actor, agentProfile } = await resolveWriteActor(context, {
        agentProfileId:
          typeof args.agentProfileId === "string"
            ? args.agentProfileId
            : undefined,
      });
      const integrationAccount = await prisma.integrationAccount.findFirst({
        where: {
          id: integrationAccountId,
          agentProfileId: agentProfile.id,
          agentProfile: {
            userId: context.userId,
          },
        },
        select: {
          id: true,
          providerType: true,
        },
      });

      if (!integrationAccount) {
        throw new NotFoundError("Integration account not found.");
      }

      if (integrationAccount.providerType !== IntegrationProviderType.WEBHOOK) {
        throw new BadRequestError(
          "Only WEBHOOK external actions are implemented in this slice.",
        );
      }

      assertAgentCapability(
        agentProfile,
        AGENT_CAPABILITY_RUNGS.PROPOSE_EXTERNAL,
      );
      return createTextResult(
        await createSuggestionRecord({
          actor,
          kind: SuggestionKind.EXTERNAL_ACTION,
          summary: String(args.summary || ""),
          payload,
          rung: AGENT_CAPABILITY_RUNGS.PROPOSE_EXTERNAL,
        }),
      );
    }
    case "integrations.list": {
      if (context.actorType !== "user") {
        throw new ForbiddenError(
          "Integration tokens cannot list integration accounts.",
        );
      }
      return createTextResult({
        integrationAccounts: await listOwnedIntegrationAccounts(context.userId),
      });
    }
    case "providers.list": {
      if (context.actorType !== "user") {
        throw new ForbiddenError(
          "Integration tokens cannot list provider credentials.",
        );
      }
      return createTextResult({
        credentials: await listOwnedProviderCredentials(context.userId),
      });
    }
    default:
      throw new NotFoundError(`Unknown MCP tool: ${toolName}`);
  }
}
