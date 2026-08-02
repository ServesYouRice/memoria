import { createHash } from "node:crypto";
import {
  AgentActionKind,
  AgentActionStatus,
  IntegrationProviderType,
} from "@/generated/prisma/client";
import type { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { AGENT_CAPABILITY_RUNGS } from "@/lib/agents/constants";
import { decryptSecret } from "@/lib/agents/crypto";
import { requireExternalWebhookExecution } from "@/lib/agents/external-delivery-policy";
import { deliverSignedWebhook } from "@/lib/agents/webhooks";
import { prisma } from "@/lib/db";
import { BadRequestError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { validateUrlForSsrf } from "@/lib/utils/ssrf-protection";

interface ExternalWebhookActor {
  userId: string;
  agentProfileId: string;
  integrationAccountId?: string | null;
  modelCredentialId?: string | null;
}

const externalWebhookRequestSchema = z.object({
  method: z.enum(["POST", "PUT", "PATCH"]).default("POST"),
  path: z.string().min(1).max(2048).optional(),
  headers: z.record(z.string(), z.string().max(2000)).default({}),
  body: z.unknown(),
});

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function buildRequestFingerprint(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function normalizeReplayCursor(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

function getWebhookSigningSecret(replayCursor: Prisma.JsonValue | null) {
  const encryptedSecret =
    normalizeReplayCursor(replayCursor).outboundSigningSecret;
  if (typeof encryptedSecret !== "string") {
    throw new BadRequestError(
      "The selected webhook integration is missing an outbound signing secret.",
    );
  }
  return decryptSecret(encryptedSecret);
}

export async function executeExternalWebhook(input: {
  actor: ExternalWebhookActor;
  integrationAccountId: string;
  summary: string;
  request: unknown;
  metadata?: unknown;
}) {
  requireExternalWebhookExecution();
  const requestData = externalWebhookRequestSchema.parse(input.request);
  const integrationAccount = await prisma.integrationAccount.findFirst({
    where: {
      id: input.integrationAccountId,
      agentProfileId: input.actor.agentProfileId,
      agentProfile: { userId: input.actor.userId },
      providerType: IntegrationProviderType.WEBHOOK,
    },
    select: {
      id: true,
      externalAccountId: true,
      replayCursor: true,
      status: true,
    },
  });
  if (!integrationAccount) {
    throw new NotFoundError("Webhook integration account not found.");
  }
  if (integrationAccount.status !== "ACTIVE") {
    throw new ForbiddenError(
      "The selected webhook integration account is not active.",
    );
  }
  if (
    requestData.path &&
    (!requestData.path.startsWith("/") || requestData.path.startsWith("//"))
  ) {
    throw new BadRequestError(
      "Webhook paths must be same-origin absolute paths beginning with one slash.",
    );
  }

  const targetUrl = requestData.path
    ? new URL(requestData.path, integrationAccount.externalAccountId).toString()
    : integrationAccount.externalAccountId;
  const urlValidation = validateUrlForSsrf(targetUrl);
  if (!urlValidation.valid) {
    throw new BadRequestError(
      urlValidation.error || "Invalid outbound webhook target.",
    );
  }

  const signingSecret = getWebhookSigningSecret(
    integrationAccount.replayCursor,
  );
  const baseMetadata = {
    integrationAccountId: integrationAccount.id,
    request: {
      method: requestData.method,
      path: requestData.path,
      headerNames: Object.keys(requestData.headers).sort(),
      bodyBytes: Buffer.byteLength(
        JSON.stringify(requestData.body ?? {}),
        "utf8",
      ),
    },
    ...(input.metadata && typeof input.metadata === "object"
      ? (input.metadata as Record<string, unknown>)
      : {}),
  };
  const agentAction = await prisma.agentAction.create({
    data: {
      userId: input.actor.userId,
      agentProfileId: input.actor.agentProfileId,
      integrationAccountId:
        input.actor.integrationAccountId ?? integrationAccount.id,
      modelCredentialId: input.actor.modelCredentialId ?? null,
      kind: AgentActionKind.EXECUTE_EXTERNAL,
      rung: AGENT_CAPABILITY_RUNGS.EXECUTE_EXTERNAL,
      status: AgentActionStatus.RUNNING,
      summary: input.summary,
      requestFingerprint: buildRequestFingerprint({
        integrationAccountId: integrationAccount.id,
        request: requestData,
        summary: input.summary,
      }),
      metadata: toJsonValue(baseMetadata),
    },
  });

  try {
    const delivery = await deliverSignedWebhook({
      url: targetUrl,
      secret: signingSecret,
      method: requestData.method,
      headers: requestData.headers,
      body: requestData.body,
      deliveryId: agentAction.id,
      idempotencyKey: agentAction.id,
    });
    const persistedDelivery = {
      deliveryId: delivery.deliveryId,
      status: delivery.status,
      ok: delivery.ok,
      responseBytes: Buffer.byteLength(delivery.responseBody, "utf8"),
    };
    const replayCursor = normalizeReplayCursor(integrationAccount.replayCursor);
    replayCursor.lastOutboundDeliveryId = delivery.deliveryId;
    replayCursor.lastOutboundDeliveryAt = new Date().toISOString();
    replayCursor.lastOutboundStatus = delivery.status;
    await prisma.integrationAccount.update({
      where: { id: integrationAccount.id },
      data: { lastSeenAt: new Date(), replayCursor: toJsonValue(replayCursor) },
    });
    if (!delivery.ok) {
      await prisma.agentAction.update({
        where: { id: agentAction.id },
        data: {
          status: AgentActionStatus.FAILED,
          metadata: toJsonValue({
            ...baseMetadata,
            delivery: persistedDelivery,
          }),
        },
      });
      throw new BadRequestError(
        `Webhook delivery failed with status ${delivery.status}.`,
      );
    }
    await prisma.agentAction.update({
      where: { id: agentAction.id },
      data: {
        status: AgentActionStatus.COMPLETED,
        metadata: toJsonValue({ ...baseMetadata, delivery: persistedDelivery }),
      },
    });
    return { agentActionId: agentAction.id, delivery };
  } catch (error) {
    await prisma.agentAction.update({
      where: { id: agentAction.id },
      data: {
        status: AgentActionStatus.FAILED,
        metadata: toJsonValue({
          ...baseMetadata,
          error:
            error instanceof Error
              ? error.message
              : "Unknown webhook delivery error",
        }),
      },
    });
    throw error;
  }
}
