import { type NextRequest, NextResponse } from "next/server";
import {
  IntegrationAuthMode,
  IntegrationProviderType,
} from "@/generated/prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApiHandler } from "@/lib/api/route-handler";
import {
  generateIntegrationToken,
  getOwnedAgentProfile,
  resolveAgentRequestContext,
} from "@/lib/agents/auth";
import { encryptSecret } from "@/lib/agents/crypto";
import { listOwnedIntegrationAccounts } from "@/lib/agents/query-core";
import { ForbiddenError, BadRequestError } from "@/lib/errors";

const createIntegrationAccountSchema = z.object({
  agentProfileId: z.string().cuid(),
  providerType: z.nativeEnum(IntegrationProviderType),
  externalAccountId: z.string().min(1).max(255),
  authMode: z
    .nativeEnum(IntegrationAuthMode)
    .default(IntegrationAuthMode.TOKEN),
});

export const GET = withApiHandler(async (request: NextRequest) => {
  const context = await resolveAgentRequestContext(request);
  if (context.actorType !== "user") {
    throw new ForbiddenError(
      "Integration tokens cannot list integration accounts.",
    );
  }

  const integrationAccounts = await listOwnedIntegrationAccounts(
    context.userId,
  );

  return NextResponse.json({ integrationAccounts });
});

export const POST = withApiHandler(async (request: NextRequest) => {
  const context = await resolveAgentRequestContext(request);
  if (context.actorType !== "user") {
    throw new ForbiddenError(
      "Integration tokens cannot create integration accounts.",
    );
  }

  const body = await request.json();
  const data = createIntegrationAccountSchema.parse(body);

  await getOwnedAgentProfile(context.userId, data.agentProfileId);

  if (data.authMode !== IntegrationAuthMode.TOKEN) {
    throw new BadRequestError(
      "Only TOKEN auth mode is implemented in this slice.",
    );
  }

  if (data.providerType === IntegrationProviderType.WEBHOOK) {
    try {
      const webhookUrl = new URL(data.externalAccountId);
      if (!["http:", "https:"].includes(webhookUrl.protocol)) {
        throw new Error("invalid protocol");
      }
    } catch {
      throw new BadRequestError(
        "WEBHOOK integration accounts must use externalAccountId as a valid http(s) delivery URL.",
      );
    }
  }

  const token = await generateIntegrationToken();
  const replayCursor =
    data.providerType === IntegrationProviderType.WEBHOOK
      ? {
          outboundSigningSecret: encryptSecret(token.plaintextToken),
        }
      : undefined;

  const integrationAccount = await prisma.integrationAccount.create({
    data: {
      agentProfileId: data.agentProfileId,
      providerType: data.providerType,
      externalAccountId: data.externalAccountId,
      authMode: data.authMode,
      encryptedSecretOrHash: token.hash,
      secretPrefix: token.prefix,
      secretSuffix: token.suffix,
      replayCursor,
    },
    select: {
      id: true,
      agentProfileId: true,
      providerType: true,
      externalAccountId: true,
      authMode: true,
      status: true,
      lastSeenAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(
    {
      integrationAccount,
      plaintextToken: token.plaintextToken,
    },
    { status: 201 },
  );
});
