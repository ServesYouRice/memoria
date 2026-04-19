import { type NextRequest, NextResponse } from "next/server";
import { AgentProfileStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import {
  DEFAULT_AGENT_ENABLED_RUNGS,
  MAX_AGENT_CAPABILITY_RUNG,
} from "@/lib/agents/constants";

const createAgentProfileSchema = z.object({
  name: z.string().min(1).max(120),
  maxCapabilityRung: z
    .number()
    .int()
    .min(0)
    .max(MAX_AGENT_CAPABILITY_RUNG)
    .optional(),
  enabledRungs: z
    .array(z.number().int().min(0).max(MAX_AGENT_CAPABILITY_RUNG))
    .optional(),
  allowedCanvasIds: z.array(z.string().cuid()).optional(),
  defaultModelCredentialId: z.string().cuid().optional().nullable(),
});

export const GET = withApiHandler(async () => {
  const { userId } = await requireAuth();

  const agentProfiles = await prisma.agentProfile.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      integrationAccounts: {
        select: {
          id: true,
          providerType: true,
          externalAccountId: true,
          authMode: true,
          status: true,
          lastSeenAt: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  return NextResponse.json({ agentProfiles });
});

export const POST = withApiHandler(async (request: NextRequest) => {
  const { userId } = await requireAuth();
  const body = await request.json();
  const data = createAgentProfileSchema.parse(body);

  if (data.defaultModelCredentialId) {
    const credential = await prisma.modelCredential.findFirst({
      where: {
        id: data.defaultModelCredentialId,
        userId,
      },
      select: { id: true },
    });

    if (!credential) {
      return NextResponse.json(
        {
          error:
            "defaultModelCredentialId does not belong to the current user.",
        },
        { status: 400 },
      );
    }
  }

  const agentProfile = await prisma.agentProfile.create({
    data: {
      userId,
      name: data.name,
      status: AgentProfileStatus.ACTIVE,
      maxCapabilityRung: data.maxCapabilityRung ?? 3,
      enabledRungs: data.enabledRungs ?? DEFAULT_AGENT_ENABLED_RUNGS,
      allowedCanvasIds: data.allowedCanvasIds ?? [],
      defaultModelCredentialId: data.defaultModelCredentialId ?? null,
    },
  });

  return NextResponse.json({ agentProfile }, { status: 201 });
});
