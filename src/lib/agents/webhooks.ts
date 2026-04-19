import { createHmac, randomUUID } from "crypto";
import { BadRequestError } from "@/lib/errors";
import { validateUrlForSsrfWithDns } from "@/lib/utils/ssrf-protection";

const RESERVED_HEADERS = new Set([
  "content-length",
  "host",
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
}

export interface SignedWebhookResponse {
  deliveryId: string;
  status: number;
  ok: boolean;
  responseBody: string;
}

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
  const validation = await validateUrlForSsrfWithDns(input.url);
  if (!validation.valid) {
    throw new BadRequestError(
      validation.error || "Webhook destination is invalid.",
    );
  }

  const body = JSON.stringify(input.body ?? {});
  const timestamp = Date.now().toString();
  const deliveryId = randomUUID();
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
    const response = await fetch(input.url, {
      method: input.method || "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-memoria-delivery-id": deliveryId,
        "x-memoria-signature": `sha256=${signature}`,
        "x-memoria-signature-timestamp": timestamp,
        ...sanitizeWebhookHeaders(input.headers),
      },
      body,
    });

    const responseBody = await response.text();

    return {
      deliveryId,
      status: response.status,
      ok: response.ok,
      responseBody,
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
