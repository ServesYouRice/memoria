import { ServiceUnavailableError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { getProviderSlot } from "@/lib/agents/providers";
import { AiProviderError } from "./errors";
import {
  assertSafeAiBaseUrl,
  markAiCredentialRejected,
  resolveAiProvider,
  type ResolvedAiProvider,
} from "./provider-resolution";
import { AiUpstreamError } from "./providers";

const logger = createLogger("ai-provider");
export const AI_SUMMARY_ITEM_LIMIT = 500;
export const AI_SUMMARY_CONTENT_BYTES = 48 * 1024;
const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful assistant for a collaborative canvas application.";

export interface GenerateOptions {
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * Whose saved provider credential to use. Without it only the server env
   * fallback applies. Budgets are enforced by the caller (`runBudgetedAi`).
   */
  userId?: string;
  signal?: AbortSignal;
}

async function assertUsableBaseUrl(resolved: ResolvedAiProvider) {
  if (resolved.source !== "user") return;
  if (resolved.baseUrl === getProviderSlot(resolved.provider).defaultBaseUrl) {
    return;
  }
  await assertSafeAiBaseUrl(resolved.baseUrl);
}

export async function generateText(options: GenerateOptions): Promise<string> {
  const resolved = await resolveAiProvider(options.userId);
  await assertUsableBaseUrl(resolved);
  try {
    return await resolved.adapter.generateText(resolved, {
      prompt: options.prompt,
      system: options.system || DEFAULT_SYSTEM_PROMPT,
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 500,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof ServiceUnavailableError) throw error;
    const upstream = error instanceof AiUpstreamError ? error : null;
    logger.warn(
      {
        provider: resolved.provider,
        source: resolved.source,
        adapter: resolved.adapter.id,
        errorName: (error as Error)?.name,
        status: upstream?.status,
        providerRequestId: upstream?.providerRequestId,
      },
      "AI provider request failed",
    );
    if (
      upstream?.authFailed &&
      resolved.credentialId &&
      resolved.secretFingerprint
    ) {
      await markAiCredentialRejected(
        resolved.credentialId,
        resolved.secretFingerprint,
      );
      throw new AiProviderError(
        "The AI provider rejected the saved key. Update it in Settings.",
      );
    }
    throw new AiProviderError();
  }
}

/** Thrown when the resolved provider cannot do what a feature asked for. */
export class AiCapabilityError extends ServiceUnavailableError {
  constructor(capability: "speechToText" | "readImage") {
    super(
      capability === "speechToText"
        ? "The saved AI provider cannot transcribe audio."
        : "The saved AI provider cannot read images.",
    );
  }
}

async function providerFailure(
  resolved: ResolvedAiProvider,
  error: unknown,
): Promise<never> {
  if (error instanceof ServiceUnavailableError) throw error;
  const upstream = error instanceof AiUpstreamError ? error : null;
  logger.warn(
    {
      provider: resolved.provider,
      source: resolved.source,
      adapter: resolved.adapter.id,
      errorName: (error as Error)?.name,
      status: upstream?.status,
      providerRequestId: upstream?.providerRequestId,
    },
    "AI provider request failed",
  );
  if (
    upstream?.authFailed &&
    resolved.credentialId &&
    resolved.secretFingerprint
  ) {
    await markAiCredentialRejected(
      resolved.credentialId,
      resolved.secretFingerprint,
    );
    throw new AiProviderError(
      "The AI provider rejected the saved key. Update it in Settings.",
    );
  }
  throw new AiProviderError();
}

export interface TranscribeOptions {
  userId: string;
  audio: Uint8Array;
  mimeType: string;
  filename: string;
  signal?: AbortSignal;
}

/** Speech-to-text on the user's provider. Budgets are the caller's. */
export async function transcribeAudio(
  options: TranscribeOptions,
): Promise<string> {
  const resolved = await resolveAiProvider(options.userId);
  if (!resolved.capabilities.speechToText || !resolved.adapter.transcribeAudio)
    throw new AiCapabilityError("speechToText");
  await assertUsableBaseUrl(resolved);
  try {
    return await resolved.adapter.transcribeAudio(resolved, {
      audio: options.audio,
      mimeType: options.mimeType,
      filename: options.filename,
      signal: options.signal,
    });
  } catch (error) {
    return providerFailure(resolved, error);
  }
}

export interface ReadImageOptions {
  userId: string;
  image: Uint8Array;
  mimeType: string;
  prompt: string;
  system: string;
  maxTokens: number;
  signal?: AbortSignal;
}

/** Image reading (vision) on the user's provider. Budgets are the caller's. */
export async function readImageText(
  options: ReadImageOptions,
): Promise<string> {
  const resolved = await resolveAiProvider(options.userId);
  if (!resolved.capabilities.readImage || !resolved.adapter.readImage)
    throw new AiCapabilityError("readImage");
  await assertUsableBaseUrl(resolved);
  try {
    return await resolved.adapter.readImage(resolved, {
      image: options.image,
      mimeType: options.mimeType,
      prompt: options.prompt,
      system: options.system,
      maxTokens: options.maxTokens,
      signal: options.signal,
    });
  } catch (error) {
    return providerFailure(resolved, error);
  }
}

export function buildCanvasSummaryContent(items: any[]): string {
  const content = items
    .slice(0, AI_SUMMARY_ITEM_LIMIT)
    .map((item) => {
      if (item.type === "NOTE") return `Note: ${item.content?.text || ""}`;
      if (item.type === "TEXT") return `Text: ${item.content?.text || ""}`;
      if (item.type === "BOOKMARK")
        return `Bookmark: ${item.content?.title || item.content?.url}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");

  const bytes = Buffer.from(content, "utf8");
  return bytes.length <= AI_SUMMARY_CONTENT_BYTES
    ? content
    : bytes.subarray(0, AI_SUMMARY_CONTENT_BYTES).toString("utf8");
}

export async function summarizeCanvas(
  items: any[],
  userId?: string,
): Promise<string> {
  const content = buildCanvasSummaryContent(items);

  if (!content) return "Canvas is empty.";

  return generateText({
    prompt: `Summarize the following canvas content into a concise paragraph:\n\n${content}`,
    system:
      "You are a succinct summarizer. Focus on the main themes and key information.",
    temperature: 0.3,
    maxTokens: 500,
    userId,
  });
}

export async function generateTags(
  content: string,
  userId?: string,
): Promise<string[]> {
  const result = await generateText({
    prompt: `Generate up to 5 relevant tags for the following content. Return them as a comma-separated list, no hashmarks:\n\n${content}`,
    system:
      "You are a precise tagging system. Output only the tags separated by commas.",
    temperature: 0.3,
    maxTokens: 80,
    userId,
  });

  return result
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}
