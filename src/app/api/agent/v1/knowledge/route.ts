import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SuggestionKind } from "@prisma/client";
import { withApiHandler } from "@/lib/api/route-handler";
import { resolveAgentRequestContext } from "@/lib/agents/auth";
import { assertAgentCapability, assertCanvasScope } from "@/lib/agents/policy";
import { AGENT_CAPABILITY_RUNGS } from "@/lib/agents/constants";
import {
  createKnowledgeEntityWrite,
  createSuggestionRecord,
} from "@/lib/agents/service-core";
import {
  listScopedKnowledgeEntities,
  requireScopedItem,
} from "@/lib/agents/query-core";
import { ForbiddenError } from "@/lib/errors";

const createKnowledgeSchema = z.object({
  action: z.enum(["propose", "create"]).default("propose"),
  itemId: z.string().cuid(),
  entityType: z.string().min(1).max(120),
  title: z.string().min(1).max(255),
  summary: z.string().max(2000).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  sourceConfidence: z.number().min(0).max(1).optional(),
});

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
  const data = createKnowledgeSchema.parse(body);
  const item = await getItemCanvasScope(context.userId, data.itemId);

  assertCanvasScope(context.agentProfile, item.canvasId);

  if (data.action === "propose") {
    assertAgentCapability(context.agentProfile, AGENT_CAPABILITY_RUNGS.PROPOSE);

    const result = await createSuggestionRecord({
      actor: {
        userId: context.userId,
        agentProfileId: context.agentProfile.id,
        integrationAccountId: context.integrationAccountId,
        modelCredentialId: context.agentProfile.defaultModelCredentialId,
      },
      kind: SuggestionKind.INTERNAL_ORGANIZATION,
      summary: `Propose knowledge entity: ${data.title}`,
      payload: {
        kind: "knowledge-entity-create",
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
    actor: {
      userId: context.userId,
      agentProfileId: context.agentProfile.id,
      integrationAccountId: context.integrationAccountId,
      modelCredentialId: context.agentProfile.defaultModelCredentialId,
    },
    itemId: data.itemId,
    entityType: data.entityType,
    title: data.title,
    summary: data.summary,
    attributes: data.attributes,
    sourceConfidence: data.sourceConfidence,
  });

  return NextResponse.json(result, { status: 201 });
});
