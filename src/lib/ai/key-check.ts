import type { ModelProvider } from "@/generated/prisma/client";
import { createLogger } from "@/lib/logger";
import { getProviderSlot } from "@/lib/agents/providers";
import { runBudgetedAi } from "@/lib/ai/budget";
import { AiBudgetError, AiDisabledError } from "@/lib/ai/errors";
import { assertSafeAiBaseUrl } from "@/lib/ai/provider-resolution";
import { AiUpstreamError, getAiAdapter } from "@/lib/ai/providers";

/**
 * IMP-102 — tests a key with one tiny request when it is saved, and says in
 * plain words whether it works. The request is fixed text (nothing of the
 * person's content), goes through the same budgets as any AI request, and
 * neither the key nor the provider's reply is logged or returned.
 */

export type AiKeyProblem =
  | "wrong-key"
  | "no-credit"
  | "wrong-address"
  | "model-unavailable"
  | "busy"
  | "not-tested"
  | "unknown";

export type AiKeyCheck =
  | { ok: true; message: string }
  | { ok: false; problem: AiKeyProblem; message: string };

const CHECK_PROMPT = "Reply with the word OK.";
const CHECK_SYSTEM = "You are checking that an API key works.";
const CHECK_MAX_TOKENS = 5;
const CHECK_TIMEOUT_MS = 20_000;

const logger = createLogger("ai-key-check");

export const AI_KEY_MESSAGES: Record<AiKeyProblem | "ok", string> = {
  ok: "Your key works. AI is on.",
  "wrong-key":
    "The provider did not accept this key. Copy the whole key again from the provider's key page and paste it here.",
  "no-credit":
    "The key is right, but the account has no credit left. Add credit or a payment method on the provider's site, then save again.",
  "wrong-address":
    "Memoria could not reach the provider at that address. Check the server address, or leave it empty to use the provider's own.",
  "model-unavailable":
    "The key works, but this model is not available to it. Pick another model from the list.",
  busy: "The provider is busy right now, so the key could not be tested. Save again in a minute.",
  "not-tested":
    "The key was saved but could not be tested now: AI use is paused or today's allowance is used up. It will be tested on first use.",
  unknown:
    "The provider did not answer as expected. Check the model name and try again in a minute.",
};

function failed(problem: AiKeyProblem): AiKeyCheck {
  return { ok: false, problem, message: AI_KEY_MESSAGES[problem] };
}

/** Maps a failed call to one plain reason. Exported for tests. */
export function classifyKeyCheckError(error: unknown): AiKeyProblem {
  if (error instanceof AiBudgetError || error instanceof AiDisabledError)
    return "not-tested";
  if (!(error instanceof AiUpstreamError)) return "unknown";
  if (error.status === 0) return "wrong-address";
  if (error.status === 401 || error.status === 403) return "wrong-key";
  if (error.status === 402 || error.hint === "credit") return "no-credit";
  if (error.hint === "model") return "model-unavailable";
  if (error.status === 404) return "wrong-address";
  if (error.status === 429 || error.status >= 500) return "busy";
  return "unknown";
}

export async function checkAiKey(input: {
  userId: string;
  provider: ModelProvider;
  model: string;
  apiKey: string;
  /** Null when the provider's own endpoint is used. */
  baseUrl: string | null;
}): Promise<AiKeyCheck> {
  const slot = getProviderSlot(input.provider);
  const baseUrl = input.baseUrl || slot.defaultBaseUrl;
  if (!baseUrl) return failed("wrong-address");
  let pinnedIp: string | null = null;
  if (input.baseUrl && input.baseUrl !== slot.defaultBaseUrl) {
    try {
      // The same safety test as every other request to a custom address.
      pinnedIp = await assertSafeAiBaseUrl(input.baseUrl);
    } catch {
      return failed("wrong-address");
    }
  }
  const adapter = getAiAdapter(input.provider);
  try {
    await runBudgetedAi(
      input.userId,
      {
        prompt: `${CHECK_SYSTEM}\n${CHECK_PROMPT}`,
        maxOutputTokens: CHECK_MAX_TOKENS,
      },
      () =>
        adapter.generateText(
          {
            provider: input.provider,
            model: input.model,
            apiKey: input.apiKey,
            baseUrl,
            pinnedIp,
          },
          {
            prompt: CHECK_PROMPT,
            system: CHECK_SYSTEM,
            temperature: 0,
            maxTokens: CHECK_MAX_TOKENS,
            signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
          },
        ),
    );
    return { ok: true, message: AI_KEY_MESSAGES.ok };
  } catch (error) {
    const problem = classifyKeyCheckError(error);
    logger.info(
      {
        provider: input.provider,
        problem,
        status: error instanceof AiUpstreamError ? error.status : undefined,
      },
      "AI key check failed",
    );
    return failed(problem);
  }
}
