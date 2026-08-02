import { type NextRequest, NextResponse } from "next/server";
import { SuggestionKind } from "@/generated/prisma/client";
import { withApiHandler } from "@/lib/api/route-handler";
import { resolveAgentRequestContext } from "@/lib/agents/auth";
import { assertAgentCapability, assertCanvasScope } from "@/lib/agents/policy";
import { AGENT_CAPABILITY_RUNGS } from "@/lib/agents/constants";
import {
  createKnowledgeEntityWrite,
  createKnowledgeRelationWrite,
  createSuggestionRecord,
} from "@/lib/agents/service-core";
import {
  listScopedKnowledgeEntities,
  requireScopedKnowledgeEntity,
  requireScopedItem,
} from "@/lib/agents/query-core";
import {
  KNOWLEDGE_ENTITY_SUGGESTION_KIND,
  KNOWLEDGE_RELATION_SUGGESTION_KIND,
  parseKnowledgeMutation,
} from "@/lib/agents/knowledge-schemas";
import { ForbiddenError } from "@/lib/errors";

async function getItemCanvasScope(userId: string, itemId: string) {
  return requireScopedItem({ userId, agentProfile: null }, itemId);
}

export const GET = withApiHandler(async (request: NextRequest) => {
  const context = await resolveAgentRequestContext(request);
  assertAgentCapability(context.agentProfile, AGENT_CAPABILITY_RUNGS.READ);

  const itemId = request.nextUrl.searchParams.get("itemId");
  const canvasId = request.nextUrl.searchParams.get("canvasId");

  if (!itemId && !canvasId) {
    return NextResponse.json(
      { error: "Either itemId or canvasId is required." },
      { status: 400 },
    );
  }

  if (canvasId) {
    assertCanvasScope(context.agentProfile, canvasId);
    return NextResponse.json(
      await listScopedKnowledgeEntities(context, {
        canvasId,
      }),
    );
  }

  const item = await getItemCanvasScope(context.userId, itemId!);
  assertCanvasScope(context.agentProfile, item.canvasId);
  return NextResponse.json(
    await listScopedKnowledgeEntities(context, {
      itemId: item.id,
    }),
  );
});

export const POST = withApiHandler(async (request: NextRequest) => {
  const context = await resolveAgentRequestContext(request, {
    requireAgentProfile: true,
  });

  if (!context.agentProfile) {
    throw new ForbiddenError("Agent profile context is required.");
  }

  const body = await request.json();
  const data = parseKnowledgeMutation(body);
  const actor = {
    userId: context.userId,
    agentProfileId: context.agentProfile.id,
    integrationAccountId: context.integrationAccountId,
    modelCredentialId: context.agentProfile.defaultModelCredentialId,
  };

  if (data.kind === "relation") {
    const sourceEntity = await requireScopedKnowledgeEntity(
      context,
      data.sourceEntityId,
    );
    const targetEntity = await requireScopedKnowledgeEntity(
      context,
      data.targetEntityId,
    );
    const sharedCanvasId = sourceEntity.canvasIds.find((canvasId) =>
      targetEntity.canvasIds.includes(canvasId),
    );

    if (!sharedCanvasId) {
      throw new ForbiddenError(
        "Knowledge relations must remain inside one scoped canvas.",
      );
    }

    assertCanvasScope(context.agentProfile, sharedCanvasId);

    if (data.action === "propose") {
      assertAgentCapability(
        context.agentProfile,
        AGENT_CAPABILITY_RUNGS.PROPOSE,
      );

      const result = await createSuggestionRecord({
        actor,
        kind: SuggestionKind.INTERNAL_ORGANIZATION,
        summary:
          data.summary ||
          `Propose knowledge relation: ${sourceEntity.title} -[${data.relationType}]-> ${targetEntity.title}`,
        payload: {
          kind: KNOWLEDGE_RELATION_SUGGESTION_KIND,
          sourceEntityId: data.sourceEntityId,
          targetEntityId: data.targetEntityId,
          relationType: data.relationType,
          summary: data.summary,
          attributes: data.attributes,
          confidence: data.confidence,
        },
        rung: AGENT_CAPABILITY_RUNGS.PROPOSE,
      });

      return NextResponse.json(result, { status: 201 });
    }

    assertAgentCapability(
      context.agentProfile,
      AGENT_CAPABILITY_RUNGS.WRITE_SINGLE,
    );

    const result = await createKnowledgeRelationWrite({
      actor,
      sourceEntityId: data.sourceEntityId,
      targetEntityId: data.targetEntityId,
      relationType: data.relationType,
      summary: data.summary,
      attributes: data.attributes,
      confidence: data.confidence,
    });

    return NextResponse.json(result, { status: 201 });
  }

  const item = await getItemCanvasScope(context.userId, data.itemId);

  assertCanvasScope(context.agentProfile, item.canvasId);

  if (data.action === "propose") {
    assertAgentCapability(context.agentProfile, AGENT_CAPABILITY_RUNGS.PROPOSE);

    const result = await createSuggestionRecord({
      actor,
      kind: SuggestionKind.INTERNAL_ORGANIZATION,
      summary: `Propose knowledge entity: ${data.title}`,
      payload: {
        kind: KNOWLEDGE_ENTITY_SUGGESTION_KIND,
        itemId: data.itemId,
        entityType: data.entityType,
        title: data.title,
        summary: data.summary,
        attributes: data.attributes,
        sourceConfidence: data.sourceConfidence,
      },
      rung: AGENT_CAPABILITY_RUNGS.PROPOSE,
    });

    return NextResponse.json(result, { status: 201 });
  }

  assertAgentCapability(
    context.agentProfile,
    AGENT_CAPABILITY_RUNGS.WRITE_SINGLE,
  );

  const result = await createKnowledgeEntityWrite({
    actor,
    itemId: data.itemId,
    entityType: data.entityType,
    title: data.title,
    summary: data.summary,
    attributes: data.attributes,
    sourceConfidence: data.sourceConfidence,
  });

  return NextResponse.json(result, { status: 201 });
});
