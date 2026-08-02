import { type NextRequest, NextResponse } from "next/server";
import { AgentActionKind } from "@/generated/prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApiHandler } from "@/lib/api/route-handler";
import { resolveAgentRequestContext } from "@/lib/agents/auth";
import { assertAgentCapability, assertCanvasScope } from "@/lib/agents/policy";
import { AGENT_CAPABILITY_RUNGS } from "@/lib/agents/constants";
import { createCanvasItemWrite } from "@/lib/agents/service-core";
import { ItemType } from "@/types/canvas";
import { parseCanvasItemContent } from "@/lib/validation/canvas-item";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

const integrationIngestSchema = z.object({
  type: z.enum(["note", "bookmark"]),
  content: z.string().min(1),
  title: z.string().max(255).optional(),
  description: z.string().max(2000).optional(),
  canvasId: z.string().cuid().optional(),
});

export const POST = withApiHandler(async (request: NextRequest) => {
  const context = await resolveAgentRequestContext(request, {
    allowUserSession: false,
    requireAgentProfile: true,
  });

  if (!context.agentProfile) {
    throw new ForbiddenError("Agent profile context is required.");
  }

  assertAgentCapability(context.agentProfile, AGENT_CAPABILITY_RUNGS.INGEST);

  const body = await request.json();
  const data = integrationIngestSchema.parse(body);

  const targetCanvas = data.canvasId
    ? await prisma.canvas.findFirst({
        where: {
          id: data.canvasId,
          userId: context.userId,
        },
      })
    : await prisma.canvas.findFirst({
        where: {
          userId: context.userId,
          name: "Inbox",
          ...(context.agentProfile.allowedCanvasIds.length > 0
            ? {
                id: {
                  in: context.agentProfile.allowedCanvasIds,
                },
              }
            : {}),
        },
        orderBy: { createdAt: "asc" },
      });

  if (!targetCanvas) {
    throw new NotFoundError("Inbox canvas not found for this integration.");
  }

  if (targetCanvas.name !== "Inbox") {
    throw new ForbiddenError(
      "Integration ingest is limited to the Inbox canvas.",
    );
  }

  assertCanvasScope(context.agentProfile, targetCanvas.id);

  const itemType = data.type === "note" ? ItemType.NOTE : ItemType.BOOKMARK;
  const content =
    data.type === "note"
      ? { text: data.content }
      : {
          url: data.content,
          title: data.title || data.content,
          description: data.description,
        };

  const validatedContent = parseCanvasItemContent(itemType, content);

  const result = await createCanvasItemWrite({
    actor: {
      userId: context.userId,
      agentProfileId: context.agentProfile.id,
      integrationAccountId: context.integrationAccountId,
      modelCredentialId: context.agentProfile.defaultModelCredentialId,
    },
    canvasId: targetCanvas.id,
    itemData: {
      type: itemType,
      positionX: 80,
      positionY: 80,
      width: data.type === "note" ? 320 : 360,
      height: data.type === "note" ? 220 : 120,
      zIndex: 0,
      content: validatedContent,
      tags: [],
    },
    summary: `Ingest ${data.type} into Inbox`,
    rung: AGENT_CAPABILITY_RUNGS.INGEST,
    actionKind: AgentActionKind.INGEST,
  });

  return NextResponse.json(result, { status: 201 });
});
