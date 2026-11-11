import { type NextRequest, NextResponse } from "next/server";
import {
  IntegrationProviderType,
  SuggestionKind,
  SuggestionStatus,
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
  assertAgentMayRevertChangeSet,
  releaseSuggestionClaim,
} from "@/lib/agents/service-core";
import {
  PILES_SUGGESTION_KIND,
  executePilesSuggestion,
  pilesSuggestionPayloadSchema,
} from "@/lib/agents/piles";
import { recordHomeBoardExecution } from "@/lib/agents/home-board";
import {
  ASK_COMMAND_SUGGESTION_KIND,
  askCommandSuggestionPayloadSchema,
  executeAskCommandSuggestion,
} from "@/lib/ai/ask-commands";
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
import { requireExternalWebhookExecution } from "@/lib/agents/external-delivery-policy";
import {
  assertSuggestionKindMatchesPayload,
  externalActionPayloadSchema,
  externalActionSummarySchema,
} from "@/lib/agents/external-action-schema";
import { createLogger } from "@/lib/logger";

const log = createLogger("agent-actions");

const timelineCanvasIdSchema = z.string().cuid().optional();

// Optional timeline filters; a request without them is unchanged.
const timelineFilterSchema = z.object({
  // Comma-separated, e.g. suggestionStatus=OPEN,APPROVED.
  suggestionStatuses: z
    .string()
    .transform((value) => value.split(",").filter(Boolean))
    .pipe(z.array(z.nativeEnum(SuggestionStatus)).max(6))
    .optional(),
  revertableOnly: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  suggestionCursor: z.string().cuid().optional(),
  changeSetCursor: z.string().cuid().optional(),
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

interface PreparedSuggestionRun {
  /** The suggestion's write; it runs only after the claim succeeds. */
  run: () => Promise<unknown>;
  /**
   * Whether a failed run may return the suggestion to APPROVED. True for
   * internal writes, which roll back as one transaction when they throw.
   */
  releaseOnFailure: boolean;
  /** Runs once the suggestion is marked executed. */
  afterExecuted?: (result: unknown) => Promise<void>;
}

/**
 * Claims an approved suggestion, runs its prepared write and marks it
 * executed. A failed internal write releases the claim so it can be retried.
 */
async function runClaimedSuggestion(
  ids: { userId: string; suggestionId: string },
  prepared: PreparedSuggestionRun,
) {
  await claimSuggestionForExecution(ids);

  let result: unknown;
  try {
    result = await prepared.run();
  } catch (error) {
    if (prepared.releaseOnFailure) {
      try {
        await releaseSuggestionClaim(ids);
      } catch (releaseError) {
        log.error(
          { err: releaseError, suggestionId: ids.suggestionId },
          "Failed to release a suggestion claim after a failed execution",
        );
      }
    } else {
      log.error(
        { err: error, suggestionId: ids.suggestionId },
        "Suggestion execution failed after dispatch; left EXECUTING",
      );
    }
    throw error;
  }

  try {
    await markSuggestionExecuted(ids);
  } catch (error) {
    // The write committed; releasing now would allow it to run twice.
    log.error(
      { err: error, suggestionId: ids.suggestionId },
      "Suggestion write committed but could not be marked executed",
    );
    throw error;
  }
  await prepared.afterExecuted?.(result);
  return result;
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
  assertAgentCapability(context.agentProfile, AGENT_CAPABILITY_RUNGS.READ);

  const { limit } = parsePagination(request.nextUrl.searchParams, {
    defaultLimit: 50,
    maxLimit: 100,
  });
  const canvasId = timelineCanvasIdSchema.parse(
    request.nextUrl.searchParams.get("canvasId") ?? undefined,
  );
  if (canvasId) {
    assertCanvasScope(context.agentProfile, canvasId);
    await verifyCanvasOwnership(context.userId, canvasId);
  }
  const filters = timelineFilterSchema.parse({
    suggestionStatuses:
      request.nextUrl.searchParams.get("suggestionStatus") ?? undefined,
    revertableOnly: request.nextUrl.searchParams.get("revertable") ?? undefined,
    suggestionCursor:
      request.nextUrl.searchParams.get("suggestionCursor") ?? undefined,
    changeSetCursor:
      request.nextUrl.searchParams.get("changeSetCursor") ?? undefined,
  });

  return NextResponse.json(
    await listScopedActionTimeline(context, {
      limit,
      canvasId,
      ...filters,
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
        summary: externalActionSummarySchema,
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

    // Undo is always the owner's right; only agents need the write rung.
    if (context.actorType !== "user") {
      assertAgentCapability(agentProfile, AGENT_CAPABILITY_RUNGS.WRITE_SINGLE);
      await assertAgentMayRevertChangeSet({
        userId: context.userId,
        agentProfile,
        changeSetId: data.changeSetId,
      });
    }

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

    // A token resolves to its own profile: it may only execute suggestions
    // that profile proposed, and must not claim (and strand) anyone else's.
    if (suggestion.agentProfileId !== agentProfile.id) {
      throw new ForbiddenError(
        "This suggestion belongs to another agent profile.",
      );
    }

    if (suggestion.status !== "APPROVED") {
      throw new BadRequestError("Only approved suggestions can be executed.");
    }

    if (suggestion.expiresAt <= new Date()) {
      throw new BadRequestError("The selected suggestion has expired.");
    }

    const suggestionPayload = suggestion.payload as Record<string, unknown>;
    assertSuggestionKindMatchesPayload(
      suggestion.kind,
      typeof suggestionPayload?.kind === "string"
        ? suggestionPayload.kind
        : null,
    );

    const actor = {
      userId: context.userId,
      agentProfileId: agentProfile.id,
      integrationAccountId: context.integrationAccountId,
      modelCredentialId: agentProfile.defaultModelCredentialId,
    };

    const payload = suggestion.payload as Record<string, unknown>;
    const payloadKind = typeof payload.kind === "string" ? payload.kind : null;

    // Every parse, ownership, scope and rung check runs before the claim, so
    // a refusal leaves the suggestion APPROVED. Only the write runs claimed.
    // Owner approval is the authority for internal-organization kinds: the
    // proposing agent needs its propose rung and canvas scope, not a
    // direct-write rung. External webhooks below still require rung 8.
    let prepared: PreparedSuggestionRun;

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
      assertAgentCapability(agentProfile, AGENT_CAPABILITY_RUNGS.PROPOSE);

      prepared = {
        releaseOnFailure: true,
        run: () =>
          createCanvasItemWrite({
            actor,
            canvasId: parsed.canvasId,
            itemData: normalizedItem,
            summary: suggestion.summary,
          }),
      };
    } else if (payloadKind === KNOWLEDGE_ENTITY_SUGGESTION_KIND) {
      const parsed = knowledgeEntitySuggestionPayloadSchema.parse(payload);
      const item = await getItemCanvasScope(context.userId, parsed.itemId);

      assertCanvasScope(agentProfile, item.canvasId);
      assertAgentCapability(agentProfile, AGENT_CAPABILITY_RUNGS.PROPOSE);

      prepared = {
        releaseOnFailure: true,
        run: () =>
          createKnowledgeEntityWrite({
            actor,
            itemId: parsed.itemId,
            entityType: parsed.entityType,
            title: parsed.title,
            summary: parsed.summary,
            attributes: parsed.attributes,
            sourceConfidence: parsed.sourceConfidence,
          }),
      };
    } else if (payloadKind === KNOWLEDGE_RELATION_SUGGESTION_KIND) {
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
      assertAgentCapability(agentProfile, AGENT_CAPABILITY_RUNGS.PROPOSE);

      prepared = {
        releaseOnFailure: true,
        run: () =>
          createKnowledgeRelationWrite({
            actor,
            sourceEntityId: parsed.sourceEntityId,
            targetEntityId: parsed.targetEntityId,
            relationType: parsed.relationType,
            summary: parsed.summary,
            attributes: parsed.attributes,
            confidence: parsed.confidence,
          }),
      };
    } else if (payloadKind === "canvas-item-batch-create") {
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
      assertAgentCapability(agentProfile, AGENT_CAPABILITY_RUNGS.PROPOSE);

      prepared = {
        releaseOnFailure: true,
        run: () =>
          createCanvasItemBatchWrite({
            actor,
            canvasId: parsed.canvasId,
            items: normalizedItems,
            summary: suggestion.summary,
            rung,
            checkpointId:
              parsed.executionMode === "bulk" ? parsed.checkpointId : null,
            checkpointReason: suggestion.summary,
          }),
      };
    } else if (payloadKind === PILES_SUGGESTION_KIND) {
      const parsed = pilesSuggestionPayloadSchema.parse(payload);
      await verifyCanvasOwnership(context.userId, parsed.canvasId);

      prepared = {
        releaseOnFailure: true,
        run: () =>
          executePilesSuggestion({
            actor,
            agentProfile,
            payload: parsed,
            summary: suggestion.summary,
          }),
      };
    } else if (payloadKind === ASK_COMMAND_SUGGESTION_KIND) {
      // Filed by Ask (IMP-068); only its own assistant profile may run it.
      const parsed = askCommandSuggestionPayloadSchema.parse(payload);
      if (suggestion.agentProfileId !== agentProfile.id) {
        throw new ForbiddenError(
          "This suggestion belongs to another agent profile.",
        );
      }

      prepared = {
        releaseOnFailure: true,
        run: () =>
          executeAskCommandSuggestion({
            actor,
            agentProfile,
            payload: parsed,
            summary: suggestion.summary,
          }),
        // A home-board Ask suggestion is finalized like an Inbox accept, so
        // the Inbox lists it as filed and its Undo works (TASK-025).
        afterExecuted: async (result) => {
          const changeSetId =
            result && typeof result === "object" && "changeSetId" in result
              ? result.changeSetId
              : null;
          if (typeof changeSetId === "string" && changeSetId) {
            await recordHomeBoardExecution({
              userId: context.userId,
              suggestionId: suggestion.id,
              changeSetId,
            });
          }
        },
      };
    } else if (payloadKind === "external-webhook") {
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
      requireExternalWebhookExecution();

      // A failed webhook may already have reached the receiver; releasing
      // it for a retry could repeat the external effect, so it stays claimed.
      prepared = {
        releaseOnFailure: false,
        run: () =>
          executeExternalWebhook({
            actor,
            integrationAccountId: parsed.integrationAccountId,
            summary: suggestion.summary,
            request: parsed.request,
            metadata: {
              suggestionId: suggestion.id,
              compensatingAction: parsed.compensatingAction,
            },
          }),
      };
    } else {
      throw new BadRequestError("Unsupported suggestion payload.");
    }

    const result = await runClaimedSuggestion(
      { userId: context.userId, suggestionId: suggestion.id },
      prepared,
    );

    return NextResponse.json(
      {
        suggestionId: suggestion.id,
        executed: result,
      },
      { status: 200 },
    );
  }

  return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
});
