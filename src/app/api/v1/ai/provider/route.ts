import { NextResponse } from "next/server";
import { CredentialStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { withAuth, withAuthValidation } from "@/lib/api/route-handler";
import { encryptSecret, fingerprintSecret } from "@/lib/agents/crypto";
import { getProviderSlot, PROVIDER_SLOTS } from "@/lib/agents/providers";
import { aiProviderSettingsSchema } from "@/lib/validation/ai";
import { ApiError, BadRequestError } from "@/lib/errors";
import {
  BUILTIN_AI_CAPABILITY,
  assertSafeAiBaseUrl,
  getAiAvailability,
} from "@/lib/ai/provider-resolution";

// Built-in AI provider settings. The key is write-only: it is encrypted into
// ModelCredential and no response ever includes it or its ciphertext.

const SAFE_SELECT = {
  id: true,
  provider: true,
  baseUrl: true,
  defaultModel: true,
  capabilities: true,
  status: true,
  lastVerifiedAt: true,
  updatedAt: true,
} as const;

type SafeCredential = {
  id: string;
  provider: string;
  baseUrl: string | null;
  defaultModel: string;
  capabilities: unknown;
  status: CredentialStatus;
  lastVerifiedAt: Date | null;
  updatedAt: Date;
};

function capabilityList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function withTag(value: unknown): string[] {
  const list = capabilityList(value).filter(
    (entry) => entry !== BUILTIN_AI_CAPABILITY,
  );
  return [...list, BUILTIN_AI_CAPABILITY];
}

function withoutTag(value: unknown): string[] {
  return capabilityList(value).filter(
    (entry) => entry !== BUILTIN_AI_CAPABILITY,
  );
}

async function findBuiltinCredential(
  userId: string,
): Promise<SafeCredential | null> {
  const rows = (await prisma.modelCredential.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: SAFE_SELECT,
  })) as SafeCredential[];
  return (
    rows.find((row) =>
      capabilityList(row.capabilities).includes(BUILTIN_AI_CAPABILITY),
    ) ?? null
  );
}

function present(credential: SafeCredential | null) {
  if (!credential) return null;
  return {
    id: credential.id,
    provider: credential.provider,
    model: credential.defaultModel,
    baseUrl: credential.baseUrl,
    status: credential.status,
    lastVerifiedAt: credential.lastVerifiedAt,
    updatedAt: credential.updatedAt,
    hasKey: true,
  };
}

const PROVIDERS = PROVIDER_SLOTS.map((slot) => ({
  provider: slot.provider,
  label: slot.label,
  defaultBaseUrl: slot.defaultBaseUrl ?? null,
  requiresBaseUrl: Boolean(slot.requiresBaseUrl),
  suggestedModels: slot.suggestedModels,
}));

async function settingsResponse(userId: string) {
  const [credential, availability] = await Promise.all([
    findBuiltinCredential(userId),
    getAiAvailability(userId),
  ]);
  return {
    providers: PROVIDERS,
    current: present(credential),
    availability,
  };
}

export const GET = withAuth(async (_request, session) => {
  return NextResponse.json(await settingsResponse(session.user.id));
});

export const PUT = withAuthValidation(
  aiProviderSettingsSchema,
  async ({ provider, model, baseUrl, apiKey }, _request, session) => {
    const userId = session.user.id;
    const slot = getProviderSlot(provider);
    // Store null when the owner left the provider's own endpoint in place.
    const storedBaseUrl =
      baseUrl && baseUrl !== slot.defaultBaseUrl ? baseUrl : null;
    if (storedBaseUrl) {
      try {
        await assertSafeAiBaseUrl(storedBaseUrl);
      } catch (error) {
        throw new BadRequestError(
          error instanceof ApiError
            ? error.detail
            : "The AI base URL cannot be used.",
        );
      }
    }

    const existing = await findBuiltinCredential(userId);

    if (!apiKey) {
      if (!existing) {
        throw new BadRequestError("Enter an API key for the AI provider.");
      }
      if (existing.provider !== provider) {
        throw new BadRequestError(
          "Enter the API key for the newly selected provider.",
        );
      }
      await prisma.modelCredential.update({
        where: { id: existing.id },
        data: { defaultModel: model, baseUrl: storedBaseUrl },
      });
      return NextResponse.json(await settingsResponse(userId));
    }

    const secretFingerprint = fingerprintSecret(apiKey);
    await prisma.$transaction(async (tx) => {
      // The same key may already be saved for an agent profile; reuse that
      // row (unique on userId + fingerprint) rather than failing.
      const duplicate = await tx.modelCredential.findFirst({
        where: { userId, secretFingerprint },
        select: { id: true, capabilities: true },
      });
      const target = duplicate ?? existing;
      const shared = {
        provider,
        baseUrl: storedBaseUrl,
        defaultModel: model,
        encryptedSecret: encryptSecret(apiKey),
        secretFingerprint,
        status: CredentialStatus.UNVERIFIED,
        lastVerifiedAt: null,
      };
      if (target) {
        await tx.modelCredential.update({
          where: { id: target.id },
          data: { ...shared, capabilities: withTag(target.capabilities) },
        });
      } else {
        await tx.modelCredential.create({
          data: {
            ...shared,
            userId,
            label: `Built-in AI (${slot.label})`,
            capabilities: [BUILTIN_AI_CAPABILITY],
          },
        });
      }
      if (existing && existing.id !== target?.id) {
        await tx.modelCredential.update({
          where: { id: existing.id },
          data: { capabilities: withoutTag(existing.capabilities) },
        });
      }
    });

    return NextResponse.json(await settingsResponse(userId));
  },
);

export const DELETE = withAuth(async (_request, session) => {
  const userId = session.user.id;
  const existing = await findBuiltinCredential(userId);
  if (existing) {
    const profileUses = await prisma.agentProfile.count({
      where: { userId, defaultModelCredentialId: existing.id },
    });
    if (profileUses > 0) {
      // An agent profile still relies on this key; only stop using it here.
      await prisma.modelCredential.update({
        where: { id: existing.id },
        data: { capabilities: withoutTag(existing.capabilities) },
      });
    } else {
      await prisma.modelCredential.delete({ where: { id: existing.id } });
    }
  }
  return NextResponse.json(await settingsResponse(userId));
});
