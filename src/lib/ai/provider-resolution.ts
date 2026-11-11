import { CredentialStatus, ModelProvider } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ServiceUnavailableError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { decryptSecret } from "@/lib/agents/crypto";
import { getProviderSlot } from "@/lib/agents/providers";
import {
  validateUrlForSsrf,
  validateUrlForSsrfWithDns,
} from "@/lib/utils/ssrf-protection";
import {
  getAiAdapter,
  getAiCapabilities,
  type AiCapabilities,
  type AiProviderAdapter,
  type AiProviderConfig,
} from "./providers";

const logger = createLogger("ai-provider-resolution");

/**
 * Capability tag that marks the credential Settings saved for built-in AI
 * (tags, summaries, chat, generate, sorting). Agent-profile credentials share
 * the `ModelCredential` table; the tag tells them apart without a migration.
 */
export const BUILTIN_AI_CAPABILITY = "builtin-ai";

export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";

export const AI_NOT_CONFIGURED_DETAIL =
  "AI not configured. Save an AI provider key in Settings, or set OPENAI_API_KEY or ANTHROPIC_API_KEY on the server.";

export type AiProviderSource = "user" | "env";

export interface ResolvedAiProvider extends AiProviderConfig {
  source: AiProviderSource;
  /** The saved credential, when `source` is "user". */
  credentialId: string | null;
  adapter: AiProviderAdapter;
  capabilities: AiCapabilities;
}

export interface AiAvailability {
  configured: boolean;
  source: AiProviderSource | null;
  provider: ModelProvider | null;
  model: string | null;
  capabilities: AiCapabilities | null;
}

const USABLE_STATUSES = [CredentialStatus.ACTIVE, CredentialStatus.UNVERIFIED];

function usableEnvKey(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed !== "dummy-key" ? trimmed : null;
}

export function allowsPrivateAiBaseUrls(): boolean {
  return process.env.AI_ALLOW_PRIVATE_BASE_URLS === "true";
}

/**
 * Owner-supplied base URLs are fetched by the server, so they pass the same
 * SSRF rules as bookmark unfurling. Self-hosters who run a local model server
 * opt in to private addresses with AI_ALLOW_PRIVATE_BASE_URLS=true.
 */
export async function assertSafeAiBaseUrl(baseUrl: string): Promise<void> {
  if (allowsPrivateAiBaseUrls()) {
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new ServiceUnavailableError("The saved AI base URL is invalid.");
    }
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      throw new ServiceUnavailableError("The saved AI base URL is invalid.");
    }
    return;
  }
  const syntactic = validateUrlForSsrf(baseUrl);
  const result = syntactic.valid
    ? await validateUrlForSsrfWithDns(baseUrl)
    : syntactic;
  if (!result.valid) {
    throw new ServiceUnavailableError(
      `The saved AI base URL cannot be used: ${result.error ?? "blocked"}.`,
    );
  }
}

function resolvedFrom(
  source: AiProviderSource,
  provider: ModelProvider,
  model: string,
  apiKey: string,
  baseUrl: string,
  credentialId: string | null,
): ResolvedAiProvider {
  const adapter = getAiAdapter(provider);
  return {
    source,
    provider,
    model,
    apiKey,
    baseUrl,
    credentialId,
    adapter,
    capabilities: getAiCapabilities(provider),
  };
}

interface CredentialRow {
  id: string;
  provider: ModelProvider;
  baseUrl: string | null;
  defaultModel: string;
  encryptedSecret: string;
  capabilities: unknown;
}

function isBuiltinCredential(row: Pick<CredentialRow, "capabilities">) {
  return (
    Array.isArray(row.capabilities) &&
    row.capabilities.includes(BUILTIN_AI_CAPABILITY)
  );
}

/**
 * The credential built-in AI uses for this user: the usable one Settings
 * saved for built-in AI. Agent-profile credentials are never picked up
 * implicitly.
 */
export async function findUserAiCredential(userId: string) {
  // The tag filter runs in the query: agent-profile credentials share this
  // table, so a window taken before the tag check could hide the built-in row.
  const rows = await prisma.modelCredential.findMany({
    where: {
      userId,
      status: { in: USABLE_STATUSES },
      capabilities: { array_contains: [BUILTIN_AI_CAPABILITY] },
    },
    orderBy: { updatedAt: "desc" },
    take: 1,
    select: {
      id: true,
      provider: true,
      baseUrl: true,
      defaultModel: true,
      encryptedSecret: true,
      capabilities: true,
    },
  });
  return rows.find(isBuiltinCredential) ?? null;
}

function fromCredential(row: CredentialRow): ResolvedAiProvider | null {
  const slot = getProviderSlot(row.provider);
  const baseUrl = row.baseUrl || slot.defaultBaseUrl;
  if (!baseUrl) return null;
  let apiKey: string;
  try {
    apiKey = decryptSecret(row.encryptedSecret);
  } catch (error) {
    logger.warn(
      { credentialId: row.id, errorName: (error as Error)?.name },
      "Saved AI credential could not be decrypted",
    );
    return null;
  }
  return resolvedFrom(
    "user",
    row.provider,
    row.defaultModel,
    apiKey,
    baseUrl,
    row.id,
  );
}

function fromEnvironment(): ResolvedAiProvider | null {
  const openAiKey = usableEnvKey(process.env.OPENAI_API_KEY);
  if (openAiKey) {
    return resolvedFrom(
      "env",
      ModelProvider.OPENAI,
      process.env.AI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
      openAiKey,
      getProviderSlot(ModelProvider.OPENAI).defaultBaseUrl!,
      null,
    );
  }
  const anthropicKey = usableEnvKey(process.env.ANTHROPIC_API_KEY);
  if (anthropicKey) {
    return resolvedFrom(
      "env",
      ModelProvider.ANTHROPIC,
      process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL,
      anthropicKey,
      getProviderSlot(ModelProvider.ANTHROPIC).defaultBaseUrl!,
      null,
    );
  }
  return null;
}

/**
 * Lookup order: the user's saved credential, then server env
 * (OPENAI_API_KEY, then ANTHROPIC_API_KEY). Returns null when neither exists.
 * Does not touch the network; callers validate custom base URLs before use.
 */
export async function findAiProvider(
  userId?: string | null,
): Promise<ResolvedAiProvider | null> {
  if (userId) {
    const row = await findUserAiCredential(userId);
    const resolved = row ? fromCredential(row) : null;
    if (resolved) return resolved;
  }
  return fromEnvironment();
}

/** Like `findAiProvider`, but throws the "AI not configured" 503. */
export async function resolveAiProvider(
  userId?: string | null,
): Promise<ResolvedAiProvider> {
  const resolved = await findAiProvider(userId);
  if (!resolved) throw new ServiceUnavailableError(AI_NOT_CONFIGURED_DETAIL);
  return resolved;
}

/** Secret-free summary for UI and for features deciding whether to offer AI. */
export async function getAiAvailability(
  userId?: string | null,
): Promise<AiAvailability> {
  const resolved = await findAiProvider(userId);
  if (!resolved) {
    return {
      configured: false,
      source: null,
      provider: null,
      model: null,
      capabilities: null,
    };
  }
  return {
    configured: true,
    source: resolved.source,
    provider: resolved.provider,
    model: resolved.model,
    capabilities: resolved.capabilities,
  };
}

/** Marks a saved credential whose key the provider rejected. */
export async function markAiCredentialRejected(
  credentialId: string,
): Promise<void> {
  await prisma.modelCredential
    .update({
      where: { id: credentialId },
      data: { status: CredentialStatus.ERROR },
    })
    .catch((error) => {
      logger.warn(
        { credentialId, errorName: (error as Error)?.name },
        "Could not flag rejected AI credential",
      );
    });
}
