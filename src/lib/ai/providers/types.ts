import type { ModelProvider } from "@/generated/prisma/client";

/**
 * Optional capabilities an adapter can advertise. Each optional capability
 * has a matching optional method on `AiProviderAdapter`; `getAiCapabilities`
 * narrows the adapter's flags per provider. Callers check the flag, never the
 * provider.
 */
export interface AiCapabilities {
  chat: true;
  speechToText: boolean;
  readImage: boolean;
  embeddings: boolean;
}

/** Everything an adapter needs to make one request. */
export interface AiProviderConfig {
  provider: ModelProvider;
  model: string;
  apiKey: string;
  baseUrl: string;
}

export interface AiTextRequest {
  prompt: string;
  system: string;
  temperature?: number;
  maxTokens: number;
  signal?: AbortSignal;
}

/** Speech-to-text for one stored audio file. */
export interface AiTranscriptionRequest {
  audio: Uint8Array;
  mimeType: string;
  filename: string;
  signal?: AbortSignal;
}

/** Read one image (text, receipt, whiteboard) with a text instruction. */
export interface AiImageRequest {
  image: Uint8Array;
  mimeType: string;
  prompt: string;
  system: string;
  maxTokens: number;
  signal?: AbortSignal;
}

export type AiAdapterId = "openai-compatible" | "anthropic";

export interface AiProviderAdapter {
  readonly id: AiAdapterId;
  readonly capabilities: AiCapabilities;
  generateText(
    config: AiProviderConfig,
    request: AiTextRequest,
  ): Promise<string>;
  /** Present when `capabilities.speechToText` can be true. */
  transcribeAudio?(
    config: AiProviderConfig,
    request: AiTranscriptionRequest,
  ): Promise<string>;
  /** Present when `capabilities.readImage` can be true. */
  readImage?(
    config: AiProviderConfig,
    request: AiImageRequest,
  ): Promise<string>;
}

/**
 * A failed upstream call. `status` is the provider HTTP status (0 for network
 * failures); `authFailed` marks a rejected key so the caller can flag a saved
 * credential instead of retrying it on every request.
 */
export class AiUpstreamError extends Error {
  constructor(
    readonly adapter: AiAdapterId,
    readonly status: number,
    message: string,
    readonly providerRequestId?: string | null,
  ) {
    super(message);
    this.name = "AiUpstreamError";
  }

  get authFailed(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export const AI_PROVIDER_TIMEOUT_MS = 60_000;

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export async function postJson(
  adapter: AiAdapterId,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  return postBody(
    adapter,
    url,
    { "content-type": "application/json", ...headers },
    JSON.stringify(body),
    signal,
  );
}

/** Multipart POST (file uploads such as `/audio/transcriptions`). */
export async function postForm(
  adapter: AiAdapterId,
  url: string,
  headers: Record<string, string>,
  body: FormData,
  signal?: AbortSignal,
): Promise<unknown> {
  // fetch sets the multipart content-type with its boundary.
  return postBody(adapter, url, headers, body, signal);
}

async function postBody(
  adapter: AiAdapterId,
  url: string,
  headers: Record<string, string>,
  body: string | FormData,
  signal?: AbortSignal,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(AI_PROVIDER_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body,
      // A saved base URL is validated before use; never follow it elsewhere.
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    throw new AiUpstreamError(
      adapter,
      0,
      `Request failed: ${(error as Error)?.name ?? "Error"}`,
    );
  }
  const requestId =
    response.headers.get("request-id") ?? response.headers.get("x-request-id");
  if (!response.ok) {
    // Drain the body so the connection is released, but never log or surface
    // it: provider error bodies can echo prompt content.
    await response.text().catch(() => undefined);
    throw new AiUpstreamError(
      adapter,
      response.status,
      `Provider returned HTTP ${response.status}`,
      requestId,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new AiUpstreamError(
      adapter,
      response.status,
      "Provider returned invalid JSON",
      requestId,
    );
  }
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
    "base64",
  );
}
