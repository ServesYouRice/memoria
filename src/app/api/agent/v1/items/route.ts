import { type NextRequest, NextResponse } from "next/server";
import { SuggestionKind } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApiHandler } from "@/lib/api/route-handler";
import { resolveAgentRequestContext } from "@/lib/agents/auth";
import { assertAgentCapability, assertCanvasScope } from "@/lib/agents/policy";
import { AGENT_CAPABILITY_RUNGS } from "@/lib/agents/constants";
import {
  createBulkCanvasItemSuggestion,
  createCanvasItemBatchWrite,
  createCanvasItemComment,
  createCanvasItemWrite,
  createSuggestionRecord,
  normalizeAgentItemWriteBatch,
  normalizeAgentItemWriteData,
} from "@/lib/agents/service-core";
import {
  listScopedCanvasItems,
  requireScopedItem,
} from "@/lib/agents/query-core";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

const singleAgentItemSchema = z.object({
  canvasId: z.string().cuid(),
  type: z.string().min(1),
  positionX: z.number().finite(),
  positionY: z.number().finite(),
  width: z.number().positive().finite(),
  height: z.number().positive().finite(),
  zIndex: z.number().int().min(0).default(0),
  content: z.unknown(),
  tags: z.array(z.string().min(1).max(64)).default([]),
  summary: z.string().min(1).max(255).optional(),
});

const commentAgentItemSchema = z.object({
  itemId: z.string().cuid(),
  content: z.string().min(1).max(5000),
  summary: z.string().min(1).max(255).optional(),
});

const batchAgentItemSchema = z.object({
  canvasId: z.string().cuid(),
  items: z.array(z.unknown()).min(1).max(100),
  summary: z.string().min(1).max(255).optional(),
});

const bulkPreviewSchema = z.object({
  canvasId: z.string().cuid(),
  items: z.array(z.unknown()).min(1).max(250),
  summary: z.string().min(1).max(255).optional(),
  checkpointReason: z.string().min(1).max(255).optional(),
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
  return requireScopedItem({ userId, agentProfile: null }, itemId);
}

export const GET = withApiHandler(async (request: NextRequest) => {
  const context = await resolveAgentRequestContext(request);
  assertAgentCapability(context.agentProfile, AGENT_CAPABILITY_RUNGS.READ);

  const canvasId = request.nextUrl.searchParams.get("canvasId");
  if (!canvasId) {
    return NextResponse.json(
      { error: "canvasId is required." },
      { status: 400 },
    );
  }

  await verifyCanvasOwnership(context.userId, canvasId);
  assertCanvasScope(context.agentProfile, canvasId);

  const items = await listScopedCanvasItems(context, canvasId);

  return NextResponse.json({ items });
});

export const POST = withApiHandler(async (request: NextRequest) => {
  const context = await resolveAgentRequestContext(request, {
    requireAgentProfile: true,
  });

  if (!context.agentProfile) {
    throw new ForbiddenError("Agent profile context is required.");
  }

  const body = await request.json();
  const action = typeof body?.action === "string" ? body.action : "propose";

  if (action === "comment") {
    const data = commentAgentItemSchema.parse(body);
    const item = await getItemCanvasScope(context.userId, data.itemId);

    assertCanvasScope(context.agentProfile, item.canvasId);
    assertAgentCapability(context.agentProfile, AGENT_CAPABILITY_RUNGS.COMMENT);

    const result = await createCanvasItemComment({
      actor: {
        userId: context.userId,
        agentProfileId: context.agentProfile.id,
        integrationAccountId: context.integrationAccountId,
        modelCredentialId: context.agentProfile.defaultModelCredentialId,
      },
      itemId: data.itemId,
      content: data.content,
      summary: data.summary || `Comment on item ${data.itemId}`,
    });

    return NextResponse.json(result, { status: 201 });
  }

  if (action === "create-batch") {
    const data = batchAgentItemSchema.parse(body);
    const normalizedItems = normalizeAgentItemWriteBatch(data.items);

    await verifyCanvasOwnership(context.userId, data.canvasId);
    assertCanvasScope(context.agentProfile, data.canvasId);
    assertAgentCapability(
      context.agentProfile,
      AGENT_CAPABILITY_RUNGS.WRITE_GROUP,
    );

    const result = await createCanvasItemBatchWrite({
      actor: {
        userId: context.userId,
        agentProfileId: context.agentProfile.id,
        integrationAccountId: context.integrationAccountId,
        modelCredentialId: context.agentProfile.defaultModelCredentialId,
      },
      canvasId: data.canvasId,
      items: normalizedItems,
      summary:
        data.summary ||
        `Create ${normalizedItems.length} items on canvas ${data.canvasId}`,
      rung: AGENT_CAPABILITY_RUNGS.WRITE_GROUP,
    });

    return NextResponse.json(result, { status: 201 });
  }

  if (action === "preview-bulk-create") {
    const data = bulkPreviewSchema.parse(body);
    const normalizedItems = normalizeAgentItemWriteBatch(data.items);

    await verifyCanvasOwnership(context.userId, data.canvasId);
    assertCanvasScope(context.agentProfile, data.canvasId);
    assertAgentCapability(context.agentProfile, AGENT_CAPABILITY_RUNGS.BULK);

    const result = await createBulkCanvasItemSuggestion({
      actor: {
        userId: context.userId,
        agentProfileId: context.agentProfile.id,
        integrationAccountId: context.integrationAccountId,
        modelCredentialId: context.agentProfile.defaultModelCredentialId,
      },
      canvasId: data.canvasId,
      items: normalizedItems,
      summary:
        data.summary ||
        `Preview bulk create of ${normalizedItems.length} items on canvas ${data.canvasId}`,
      checkpointReason:
        data.checkpointReason ||
        data.summary ||
        `Bulk preview before creating ${normalizedItems.length} items`,
    });

    return NextResponse.json(result, { status: 201 });
  }

  const data = singleAgentItemSchema.parse(body);
  const normalizedItem = normalizeAgentItemWriteData(data);

  await verifyCanvasOwnership(context.userId, data.canvasId);
  assertCanvasScope(context.agentProfile, data.canvasId);

  if (action === "propose") {
    assertAgentCapability(context.agentProfile, AGENT_CAPABILITY_RUNGS.PROPOSE);

    const result = await createSuggestionRecord({
      actor: {
        userId: context.userId,
        agentProfileId: context.agentProfile.id,
        integrationAccountId: context.integrationAccountId,
        modelCredentialId: context.agentProfile.defaultModelCredentialId,
      },
      kind: SuggestionKind.INTERNAL_ORGANIZATION,
      summary:
        data.summary ||
        `Propose ${normalizedItem.type.toLowerCase()} creation on canvas ${data.canvasId}`,
      payload: {
        kind: "canvas-item-create",
        canvasId: data.canvasId,
        item: normalizedItem,
      },
      rung: AGENT_CAPABILITY_RUNGS.PROPOSE,
    });

    return NextResponse.json(result, { status: 201 });
  }

  if (action !== "create") {
    return NextResponse.json(
      { error: `Unsupported action: ${action}` },
      { status: 400 },
    );
  }

  assertAgentCapability(
    context.agentProfile,
    AGENT_CAPABILITY_RUNGS.WRITE_SINGLE,
  );

  const result = await createCanvasItemWrite({
    actor: {
      userId: context.userId,
      agentProfileId: context.agentProfile.id,
      integrationAccountId: context.integrationAccountId,
      modelCredentialId: context.agentProfile.defaultModelCredentialId,
    },
    canvasId: data.canvasId,
    itemData: normalizedItem,
    summary:
      data.summary ||
      `Create ${normalizedItem.type.toLowerCase()} on canvas ${data.canvasId}`,
  });

  return NextResponse.json(result, { status: 201 });
});
