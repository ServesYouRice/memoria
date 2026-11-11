/**
 * Text embeddings for near-duplicate links (IMP-065). Available when the
 * owner's provider adapter advertises `embeddings` and an embedding model is
 * known: AI_EMBEDDING_MODEL, or OpenAI's default for the OpenAI provider.
 * Budgeted like every other AI request; never throws for "not available".
 */

import { ModelProvider } from "@/generated/prisma/client";
import { createLogger } from "@/lib/logger";
import { getProviderSlot } from "@/lib/agents/providers";
import { isAiEnabled, runBudgetedAi, aiMaxPromptBytes } from "./budget";
import {
  assertSafeAiBaseUrl,
  findAiProvider,
  type ResolvedAiProvider,
} from "./provider-resolution";
import { truncateUtf8 } from "./enrich-link";

const logger = createLogger("ai-embeddings");

export const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
/** Text embedded per link; titles and summaries are far shorter. */
const MAX_EMBEDDING_BYTES = 8 * 1024;

export function embeddingModelFor(resolved: ResolvedAiProvider): string | null {
  if (!resolved.capabilities.embeddings || !resolved.adapter.embed) return null;
  const configured = process.env.AI_EMBEDDING_MODEL?.trim();
  if (configured) return configured;
  return resolved.provider === ModelProvider.OPENAI
    ? DEFAULT_OPENAI_EMBEDDING_MODEL
    : null;
}

export type EmbeddingResult =
  | { ok: true; provider: string; model: string; vector: number[] }
  | { ok: false; reason: "not-configured" | "unavailable" };

export async function embedText(input: {
  userId: string;
  text: string;
  signal?: AbortSignal;
}): Promise<EmbeddingResult> {
  if (!isAiEnabled()) return { ok: false, reason: "unavailable" };
  const resolved = await findAiProvider(input.userId);
  const model = resolved ? embeddingModelFor(resolved) : null;
  if (!resolved || !model) return { ok: false, reason: "not-configured" };
  const text = truncateUtf8(
    input.text,
    Math.min(MAX_EMBEDDING_BYTES, aiMaxPromptBytes()),
  );
  if (!text.trim()) return { ok: false, reason: "unavailable" };
  try {
    if (
      resolved.source === "user" &&
      resolved.baseUrl !== getProviderSlot(resolved.provider).defaultBaseUrl
    ) {
      resolved.pinnedIp = await assertSafeAiBaseUrl(resolved.baseUrl);
    }
    const { value } = await runBudgetedAi(
      input.userId,
      { prompt: text, maxOutputTokens: 1 },
      () =>
        resolved.adapter.embed!(resolved, {
          model,
          input: [text],
          signal: input.signal,
        }),
    );
    return {
      ok: true,
      provider: resolved.provider,
      model,
      vector: value[0]!,
    };
  } catch (error) {
    // Budget, base-URL and provider failures all mean "no embedding today".
    logger.info(
      { provider: resolved.provider, errorName: (error as Error)?.name },
      "Embedding skipped",
    );
    return { ok: false, reason: "unavailable" };
  }
}
