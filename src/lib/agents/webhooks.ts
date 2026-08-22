import { createHmac, randomUUID } from "crypto";
import { BadRequestError } from "@/lib/errors";
import {
  pinnedHttpRequest,
  validateUrlForSsrfWithDns,
} from "@/lib/utils/ssrf-protection";

const RESERVED_HEADERS = new Set([
  "content-length",
  "host",
  "idempotency-key",
  "x-memoria-delivery-id",
  "x-memoria-signature",
  "x-memoria-signature-timestamp",
]);

export interface SignedWebhookRequest {
  url: string;
  secret: string;
  body: unknown;
  method?: "POST" | "PUT" | "PATCH";
  headers?: Record<string, string>;
  timeoutMs?: number;
  deliveryId?: string;
  idempotencyKey?: string;
}

export interface SignedWebhookResponse {
  deliveryId: string;
  status: number;
  ok: boolean;
  responseBody: string;
}

const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 64 * 1024;

function sanitizeWebhookHeaders(headers?: Record<string, string>) {
  const sanitized: Record<string, string> = {};

  for (const [rawName, rawValue] of Object.entries(headers || {})) {
    const name = rawName.trim();
    const value = rawValue.trim();

    if (!name || !value) {
      continue;
    }

    if (!/^[A-Za-z0-9-]+$/.test(name)) {
      throw new BadRequestError(`Invalid webhook header name: ${name}`);
    }

    if (/[\r\n]/.test(value)) {
      throw new BadRequestError(`Invalid webhook header value for ${name}.`);
    }

    const canonical = name.toLowerCase();
    if (RESERVED_HEADERS.has(canonical)) {
      continue;
    }

    sanitized[name] = value;
  }

  return sanitized;
}

function buildSignaturePayload(
  timestamp: string,
  deliveryId: string,
  body: string,
) {
  return `${timestamp}.${deliveryId}.${body}`;
}

export function createWebhookSignature(input: {
  secret: string;
  timestamp: string;
  deliveryId: string;
  body: string;
}) {
  return createHmac("sha256", input.secret)
    .update(
      buildSignaturePayload(input.timestamp, input.deliveryId, input.body),
    )
    .digest("hex");
}

export async function deliverSignedWebhook(
  input: SignedWebhookRequest,
): Promise<SignedWebhookResponse> {
  const body = JSON.stringify(input.body ?? {});
  const timestamp = Date.now().toString();
  const deliveryId = input.deliveryId || randomUUID();
  const signature = createWebhookSignature({
    secret: input.secret,
    timestamp,
    deliveryId,
    body,
  });
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? 10000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let currentUrl = input.url;
    let finalResponse: { status: number; ok: boolean; body: string } | undefined;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const validation = await validateUrlForSsrfWithDns(currentUrl);
      if (!validation.valid || !validation.pinnedIp || !validation.targetUrl) {
        throw new BadRequestError(
          validation.error || "Webhook destination is invalid.",
        );
      }

      const headers = {
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey || deliveryId,
        "x-memoria-delivery-id": deliveryId,
        "x-memoria-signature": `sha256=${signature}`,
        "x-memoria-signature-timestamp": timestamp,
        ...sanitizeWebhookHeaders(input.headers),
      };

      const response = await pinnedHttpRequest(
        validation.targetUrl,
        validation.pinnedIp,
        {
          method: input.method || "POST",
          headers,
          body,
          timeout: timeoutMs,
          maxSize: MAX_RESPONSE_BYTES,
        },
      );

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers["location"];
        if (!location || typeof location !== "string") {
          finalResponse = response;
          break;
        }
        if (hop === MAX_REDIRECTS) {
          throw new BadRequestError("Webhook redirect limit exceeded.");
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      finalResponse = response;
      break;
    }

    if (!finalResponse) {
      throw new BadRequestError("Webhook delivery did not produce a response.");
    }

    return {
      deliveryId,
      status: finalResponse.status,
      ok: finalResponse.ok,
      responseBody: finalResponse.body,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new BadRequestError("Webhook delivery timed out.");
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
