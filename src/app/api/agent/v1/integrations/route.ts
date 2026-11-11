import { randomBytes } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import {
  IntegrationAuthMode,
  IntegrationProviderType,
  Prisma,
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
import { ForbiddenError, BadRequestError, ConflictError } from "@/lib/errors";

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
  // A WEBHOOK account signs outbound deliveries with its own random secret.
  // Receivers must hold that secret to verify signatures, so it must not be
  // the bearer token, which would hand them a working API credential and keep
  // a reversible copy of a token that is otherwise stored only as a hash.
  const webhookSigningSecret =
    data.providerType === IntegrationProviderType.WEBHOOK
      ? randomBytes(32).toString("base64url")
      : null;
  const replayCursor = webhookSigningSecret
    ? { outboundSigningSecret: encryptSecret(webhookSigningSecret) }
    : undefined;

  const integrationAccount = await prisma.integrationAccount
    .create({
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
    })
    .catch((error: unknown) => {
      // Uniqueness is scoped to the agent profile, so a violation only ever
      // describes the caller's own profile and says nothing about other tenants.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictError(
          "This agent profile already has that integration account.",
        );
      }
      throw error;
    });

  return NextResponse.json(
    {
      integrationAccount,
      plaintextToken: token.plaintextToken,
      ...(webhookSigningSecret ? { webhookSigningSecret } : {}),
    },
    { status: 201 },
  );
});
