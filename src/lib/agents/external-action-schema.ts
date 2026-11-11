/**
 * The external-action proposal contract shared by the REST actions route and
 * the MCP tools, and the rule tying a suggestion's stored kind to the payload
 * it carries.
 *
 * @module lib/agents/external-action-schema
 */

import { SuggestionKind } from "@/generated/prisma/client";
import { z } from "zod";
import { BadRequestError } from "@/lib/errors";

export const EXTERNAL_WEBHOOK_PAYLOAD_KIND = "external-webhook";

const headerValueSchema = z.string().min(1).max(2000);
export const externalActionPayloadSchema = z.object({
  kind: z.literal(EXTERNAL_WEBHOOK_PAYLOAD_KIND),
  integrationAccountId: z.string().cuid(),
  request: z.object({
    method: z.enum(["POST", "PUT", "PATCH"]).default("POST"),
    path: z.string().min(1).max(2048).optional(),
    headers: z.record(z.string(), headerValueSchema).default({}),
    body: z.unknown(),
  }),
  compensatingAction: z.record(z.string(), z.unknown()).optional(),
});

export const externalActionSummarySchema = z.string().min(1).max(255);

/**
 * An EXTERNAL_ACTION suggestion must carry an external-webhook payload, and
 * an external-webhook payload must be stored as EXTERNAL_ACTION. Execution
 * dispatches on the payload, so a mismatch would run something other than
 * what the owner was shown. Check before claiming the suggestion.
 */
export function assertSuggestionKindMatchesPayload(
  kind: SuggestionKind | string | null | undefined,
  payloadKind: string | null,
) {
  const isExternalKind = kind === SuggestionKind.EXTERNAL_ACTION;
  const isExternalPayload = payloadKind === EXTERNAL_WEBHOOK_PAYLOAD_KIND;
  if (isExternalKind !== isExternalPayload) {
    throw new BadRequestError(
      "The suggestion's kind does not match its payload.",
    );
  }
}
