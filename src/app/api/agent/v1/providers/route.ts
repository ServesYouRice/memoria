import { type NextRequest, NextResponse } from "next/server";
import { CredentialStatus, ModelProvider } from "@/generated/prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApiHandler } from "@/lib/api/route-handler";
import { resolveAgentRequestContext } from "@/lib/agents/auth";
import { encryptSecret, fingerprintSecret } from "@/lib/agents/crypto";
import { PROVIDER_SLOTS } from "@/lib/agents/providers";
import { listOwnedProviderCredentials } from "@/lib/agents/query-core";
import { ForbiddenError } from "@/lib/errors";

const createModelCredentialSchema = z.object({
  provider: z.nativeEnum(ModelProvider),
  label: z.string().min(1).max(120),
  baseUrl: z.string().url().optional().nullable(),
  defaultModel: z.string().min(1).max(160),
  secret: z.string().min(1),
  capabilities: z.array(z.string().min(1)).optional(),
  dailySpendCap: z.number().nonnegative().optional().nullable(),
  monthlySpendCap: z.number().nonnegative().optional().nullable(),
});

export const GET = withApiHandler(async (request: NextRequest) => {
  const context = await resolveAgentRequestContext(request);
  if (context.actorType !== "user") {
    throw new ForbiddenError(
      "Integration tokens cannot list provider credentials.",
    );
  }

  const credentials = await listOwnedProviderCredentials(context.userId);

  return NextResponse.json({
    providerSlots: PROVIDER_SLOTS,
    credentials,
  });
});

export const POST = withApiHandler(async (request: NextRequest) => {
  const context = await resolveAgentRequestContext(request);
  if (context.actorType !== "user") {
    throw new ForbiddenError(
      "Integration tokens cannot create provider credentials.",
    );
  }

  const body = await request.json();
  const data = createModelCredentialSchema.parse(body);

  const credential = await prisma.modelCredential.create({
    data: {
      userId: context.userId,
      provider: data.provider,
      label: data.label,
      baseUrl: data.baseUrl ?? null,
      defaultModel: data.defaultModel,
      encryptedSecret: encryptSecret(data.secret),
      secretFingerprint: fingerprintSecret(data.secret),
      capabilities: data.capabilities,
      dailySpendCap: data.dailySpendCap ?? null,
      monthlySpendCap: data.monthlySpendCap ?? null,
      status: CredentialStatus.UNVERIFIED,
    },
    select: {
      id: true,
      provider: true,
      label: true,
      baseUrl: true,
      defaultModel: true,
      capabilities: true,
      dailySpendCap: true,
      monthlySpendCap: true,
      status: true,
      lastVerifiedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ credential }, { status: 201 });
});
