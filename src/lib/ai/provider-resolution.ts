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

export const AI_SAVED_CREDENTIAL_UNUSABLE_DETAIL =
  "Your saved AI provider key cannot be used. Update it in Settings.";

export type AiProviderSource = "user" | "env";

/**
 * Why no provider resolved even though the user saved one for built-in AI.
 * The env keys are not used in its place: the user chose their provider.
 */
export type AiUnavailableReason = "saved-credential-unusable";

export interface ResolvedAiProvider extends AiProviderConfig {
  source: AiProviderSource;
  /** The saved credential, when `source` is "user". */
  credentialId: string | null;
  /** Fingerprint of the saved secret this resolution decrypted. */
  secretFingerprint: string | null;
  adapter: AiProviderAdapter;
  capabilities: AiCapabilities;
}

export interface AiAvailability {
  configured: boolean;
  source: AiProviderSource | null;
  provider: ModelProvider | null;
  model: string | null;
  capabilities: AiCapabilities | null;
  /** Set only when a saved built-in credential exists but cannot be used. */
  reason?: AiUnavailableReason;
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
  secretFingerprint: string | null = null,
): ResolvedAiProvider {
  const adapter = getAiAdapter(provider);
  return {
    source,
    provider,
    model,
    apiKey,
    baseUrl,
    credentialId,
    secretFingerprint,
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
  secretFingerprint: string;
  capabilities: unknown;
}

function isBuiltinCredential(row: Pick<CredentialRow, "capabilities">) {
  return (
    Array.isArray(row.capabilities) &&
    row.capabilities.includes(BUILTIN_AI_CAPABILITY)
  );
}

const CREDENTIAL_SELECT = {
  id: true,
  provider: true,
  baseUrl: true,
  defaultModel: true,
  encryptedSecret: true,
  secretFingerprint: true,
  capabilities: true,
} as const;

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
    select: CREDENTIAL_SELECT,
  });
  return rows.find(isBuiltinCredential) ?? null;
}

/** Whether the user saved a built-in AI credential, in any status. */
async function hasSavedBuiltinCredential(userId: string): Promise<boolean> {
  const rows = await prisma.modelCredential.findMany({
    where: {
      userId,
      capabilities: { array_contains: [BUILTIN_AI_CAPABILITY] },
    },
    orderBy: { updatedAt: "desc" },
    take: 1,
    select: { id: true, capabilities: true },
  });
  return rows.some(isBuiltinCredential);
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
    row.secretFingerprint,
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

interface AiProviderLookup {
  resolved: ResolvedAiProvider | null;
  reason?: AiUnavailableReason;
}

/**
 * Lookup order: the user's saved credential, then server env
 * (OPENAI_API_KEY, then ANTHROPIC_API_KEY). A user who saved a built-in
 * credential that cannot be used (rejected, undecryptable, no base URL) gets
 * no provider rather than the server's key: their content stays off a
 * provider they did not choose.
 */
async function lookupAiProvider(
  userId?: string | null,
): Promise<AiProviderLookup> {
  if (userId) {
    const row = await findUserAiCredential(userId);
    const resolved = row ? fromCredential(row) : null;
    if (resolved) return { resolved };
    if (row || (await hasSavedBuiltinCredential(userId))) {
      return { resolved: null, reason: "saved-credential-unusable" };
    }
  }
  return { resolved: fromEnvironment() };
}

/**
 * The provider built-in AI uses, or null when none can be used. Does not
 * touch the network; callers validate custom base URLs before use.
 */
export async function findAiProvider(
  userId?: string | null,
): Promise<ResolvedAiProvider | null> {
  return (await lookupAiProvider(userId)).resolved;
}

/** Like `findAiProvider`, but throws the "AI not configured" 503. */
export async function resolveAiProvider(
  userId?: string | null,
): Promise<ResolvedAiProvider> {
  const { resolved, reason } = await lookupAiProvider(userId);
  if (!resolved) {
    throw new ServiceUnavailableError(
      reason === "saved-credential-unusable"
        ? AI_SAVED_CREDENTIAL_UNUSABLE_DETAIL
        : AI_NOT_CONFIGURED_DETAIL,
    );
  }
  return resolved;
}

/** Secret-free summary for UI and for features deciding whether to offer AI. */
export async function getAiAvailability(
  userId?: string | null,
): Promise<AiAvailability> {
  const { resolved, reason } = await lookupAiProvider(userId);
  if (!resolved) {
    return {
      configured: false,
      source: null,
      provider: null,
      model: null,
      capabilities: null,
      ...(reason ? { reason } : {}),
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

/**
 * Marks a saved credential whose key the provider rejected. Only the secret
 * that failed is flagged: if Settings replaced the key while the request was
 * in flight, the row's fingerprint no longer matches and nothing changes.
 */
export async function markAiCredentialRejected(
  credentialId: string,
  secretFingerprint: string,
): Promise<void> {
  await prisma.modelCredential
    .updateMany({
      where: { id: credentialId, secretFingerprint },
      data: { status: CredentialStatus.ERROR },
    })
    .catch((error) => {
      logger.warn(
        { credentialId, errorName: (error as Error)?.name },
        "Could not flag rejected AI credential",
      );
    });
}
