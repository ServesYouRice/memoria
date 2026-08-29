import { ApiError } from "@/lib/errors";

export class AiDisabledError extends ApiError {
  constructor() {
    super(
      503,
      "https://memoria.local/errors/ai-disabled",
      "AI unavailable",
      "AI features are disabled by the operator.",
      { code: "AI_DISABLED" },
    );
  }
}

export class AiBudgetError extends ApiError {
  constructor(
    code: "AI_TOKEN_BUDGET" | "AI_COST_BUDGET" | "AI_CONCURRENCY_BUDGET",
    detail: string,
    retryAfter: number,
  ) {
    super(
      429,
      "https://memoria.local/errors/ai-budget",
      "AI budget reached",
      detail,
      { code, retryAfter },
    );
  }
}

export class AiBudgetStoreError extends ApiError {
  constructor() {
    super(
      503,
      "https://memoria.local/errors/ai-budget-store",
      "AI safety controls unavailable",
      "AI is paused because its shared budget store is unavailable.",
      { code: "AI_BUDGET_STORE_UNAVAILABLE" },
    );
  }
}

export class AiProviderError extends ApiError {
  constructor(detail = "The AI provider could not complete this request.") {
    super(
      502,
      "https://memoria.local/errors/ai-provider",
      "AI provider error",
      detail,
      { code: "AI_PROVIDER_ERROR" },
    );
  }
}
