import { type NextRequest, NextResponse } from "next/server";
import { AgentProfileStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api/auth";
import { NotFoundError } from "@/lib/errors";
import { withApiHandler } from "@/lib/api/route-handler";
import { MAX_AGENT_CAPABILITY_RUNG } from "@/lib/agents/constants";

const updateAgentProfileSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  status: z.nativeEnum(AgentProfileStatus).optional(),
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
  defaultModelCredentialId: z.string().cuid().nullable().optional(),
});

interface RouteContext {
  params: Promise<{ agentProfileId: string }>;
}

export const GET = withApiHandler(
  async (_request: NextRequest, { params }: RouteContext) => {
    const { userId } = await requireAuth();
    const { agentProfileId } = await params;

    const agentProfile = await prisma.agentProfile.findFirst({
      where: {
        id: agentProfileId,
        userId,
      },
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

    if (!agentProfile) {
      throw new NotFoundError("Agent profile not found.");
    }

    return NextResponse.json({ agentProfile });
  },
);

export const PATCH = withApiHandler(
  async (request: NextRequest, { params }: RouteContext) => {
    const { userId } = await requireAuth();
    const { agentProfileId } = await params;
    const body = await request.json();
    const data = updateAgentProfileSchema.parse(body);

    const existing = await prisma.agentProfile.findFirst({
      where: {
        id: agentProfileId,
        userId,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      throw new NotFoundError("Agent profile not found.");
    }

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

    const agentProfile = await prisma.agentProfile.update({
      where: { id: agentProfileId },
      data,
    });

    return NextResponse.json({ agentProfile });
  },
);

export const DELETE = withApiHandler(
  async (_request: NextRequest, { params }: RouteContext) => {
    const { userId } = await requireAuth();
    const { agentProfileId } = await params;

    const existing = await prisma.agentProfile.findFirst({
      where: {
        id: agentProfileId,
        userId,
      },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundError("Agent profile not found.");
    }

    const agentProfile = await prisma.agentProfile.update({
      where: { id: agentProfileId },
      data: {
        status: AgentProfileStatus.DISABLED,
      },
    });

    return NextResponse.json({ agentProfile });
  },
);
