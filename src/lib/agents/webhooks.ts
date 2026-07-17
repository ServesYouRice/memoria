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

const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 64 * 1024;

async function readBoundedResponseBody(response: Response): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let result = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return `${result}${decoder.decode(
          value.subarray(
            0,
            Math.max(0, MAX_RESPONSE_BYTES - (size - value.byteLength)),
          ),
          { stream: true },
        )}\n[response truncated]`;
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
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
    let targetUrl = input.url;
    let response: Response | undefined;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const validation = await validateUrlForSsrfWithDns(targetUrl);
      if (!validation.valid) {
        throw new BadRequestError(
          validation.error || "Webhook destination is invalid.",
        );
      }

      response = await fetch(targetUrl, {
        method: input.method || "POST",
        redirect: "manual",
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

      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location) break;
      if (hop === MAX_REDIRECTS) {
        throw new BadRequestError("Webhook redirect limit exceeded.");
      }
      targetUrl = new URL(location, targetUrl).toString();
    }

    if (!response) {
      throw new BadRequestError("Webhook delivery did not produce a response.");
    }

    const responseBody = await readBoundedResponseBody(response);

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
