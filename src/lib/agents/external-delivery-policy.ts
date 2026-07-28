import { ForbiddenError } from "@/lib/errors";

export function requireExternalWebhookExecution(): void {
  throw new ForbiddenError("External webhook execution is disabled for v1.");
}
