import type { ModelProvider } from "@/generated/prisma/client";
import { pinnedHttpRequest } from "@/lib/utils/ssrf-protection";
import type { AiChatTurn } from "../chat-history";

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
  /**
   * The address the SSRF check validated for a user-supplied `baseUrl`.
   * When set, requests connect to it instead of resolving the host again.
   */
  pinnedIp?: string | null;
}

export interface AiTextRequest {
  prompt: string;
  system: string;
  /** Earlier chat turns, oldest first, sent before `prompt`. */
  history?: AiChatTurn[];
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

export interface AiEmbeddingRequest {
  /** Embedding model; the chat model in `config` is not used. */
  model: string;
  input: string[];
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
  /** Present when `capabilities.embeddings` is true; one vector per input. */
  embed?(
    config: AiProviderConfig,
    request: AiEmbeddingRequest,
  ): Promise<number[][]>;
}

/**
 * A failed upstream call. `status` is the provider HTTP status (0 for network
 * failures); `authFailed` marks a rejected key so the caller can flag a saved
 * credential instead of retrying it on every request.
 */
/**
 * What a provider's error body says, reduced to a word (IMP-102). The body
 * itself is never kept: it can echo prompt content.
 */
export type AiUpstreamHint = "credit" | "model";

export function hintFromErrorBody(
  body: Buffer | null,
): AiUpstreamHint | undefined {
  if (!body || body.byteLength === 0) return undefined;
  const text = body.subarray(0, 4096).toString("utf8").toLowerCase();
  if (
    /insufficient_quota|credit balance|credits?\b|billing|payment|quota|exceeded your current/.test(
      text,
    )
  )
    return "credit";
  if (
    /model/.test(text) &&
    /not[ _]found|does not exist|not available|unavailable|invalid|unknown|no access|not supported|decommissioned/.test(
      text,
    )
  )
    return "model";
  return undefined;
}

export class AiUpstreamError extends Error {
  constructor(
    readonly adapter: AiAdapterId,
    readonly status: number,
    message: string,
    readonly providerRequestId?: string | null,
    readonly hint?: AiUpstreamHint,
  ) {
    super(message);
    this.name = "AiUpstreamError";
  }

  /**
   * Only 401 means the key itself was rejected. Providers send 403 for
   * permission, region and moderation refusals that a new key would not fix.
   */
  get authFailed(): boolean {
    return this.status === 401;
  }
}

export const AI_PROVIDER_TIMEOUT_MS = 60_000;
/** Largest provider response body read, on success and error paths alike. */
export const AI_PROVIDER_MAX_RESPONSE_BYTES = 1024 * 1024;

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export async function postJson(
  adapter: AiAdapterId,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
  pinnedIp?: string | null,
): Promise<unknown> {
  return postBody(
    adapter,
    url,
    { "content-type": "application/json", ...headers },
    JSON.stringify(body),
    signal,
    pinnedIp,
  );
}

/** Multipart POST (file uploads such as `/audio/transcriptions`). */
export async function postForm(
  adapter: AiAdapterId,
  url: string,
  headers: Record<string, string>,
  body: FormData,
  signal?: AbortSignal,
  pinnedIp?: string | null,
): Promise<unknown> {
  // fetch sets the multipart content-type with its boundary.
  return postBody(adapter, url, headers, body, signal, pinnedIp);
}

interface ProviderResponse {
  status: number;
  ok: boolean;
  requestId: string | null;
  /** The body, or null when it passed the byte cap. */
  body: Buffer | null;
}

/** Reads at most `limit` bytes; null (and the stream cancelled) past it. */
async function readCapped(
  response: Response,
  limit: number,
): Promise<Buffer | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function viaFetch(
  url: string,
  headers: Record<string, string>,
  body: string | FormData,
  signal: AbortSignal,
): Promise<ProviderResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
    // A saved base URL is validated before use; never follow it elsewhere.
    redirect: "error",
    signal,
  });
  return {
    status: response.status,
    ok: response.ok,
    requestId:
      response.headers.get("request-id") ??
      response.headers.get("x-request-id"),
    // An error body is only drained; a failed read keeps the status.
    body: response.ok
      ? await readCapped(response, AI_PROVIDER_MAX_RESPONSE_BYTES)
      : await readCapped(response, AI_PROVIDER_MAX_RESPONSE_BYTES).catch(
          () => null,
        ),
  };
}

/**
 * Connects to the address the SSRF check validated, so a second DNS answer
 * (rebinding) is never contacted. Redirects are not followed.
 */
async function viaPinnedIp(
  url: string,
  pinnedIp: string,
  headers: Record<string, string>,
  body: string | FormData,
  signal: AbortSignal,
): Promise<ProviderResponse> {
  let payload: Buffer;
  const sent: Record<string, string> = {
    accept: "application/json",
    "user-agent": "Memoria/1.0",
    ...headers,
  };
  if (typeof body === "string") {
    payload = Buffer.from(body, "utf8");
  } else {
    // Encode the multipart body (and its boundary) the way fetch would.
    const encoded = new Response(body);
    payload = Buffer.from(await encoded.arrayBuffer());
    sent["content-type"] = encoded.headers.get("content-type")!;
  }
  sent["content-length"] = String(payload.byteLength);
  try {
    const response = await pinnedHttpRequest(new URL(url), pinnedIp, {
      method: "POST",
      headers: sent,
      body: payload,
      timeout: AI_PROVIDER_TIMEOUT_MS,
      maxSize: AI_PROVIDER_MAX_RESPONSE_BYTES,
      signal,
    });
    const requestId =
      response.headers["request-id"] ?? response.headers["x-request-id"];
    return {
      status: response.status,
      ok: response.ok,
      requestId: typeof requestId === "string" ? requestId : null,
      body: response.rawBody,
    };
  } catch (error) {
    const status = (error as { status?: unknown })?.status;
    if (
      (error as Error)?.message === "Response too large" &&
      typeof status === "number"
    ) {
      return {
        status,
        ok: status >= 200 && status < 300,
        requestId: null,
        body: null,
      };
    }
    throw error;
  }
}

async function postBody(
  adapter: AiAdapterId,
  url: string,
  headers: Record<string, string>,
  body: string | FormData,
  signal?: AbortSignal,
  pinnedIp?: string | null,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(AI_PROVIDER_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: ProviderResponse;
  try {
    response = pinnedIp
      ? await viaPinnedIp(url, pinnedIp, headers, body, combined)
      : await viaFetch(url, headers, body, combined);
  } catch (error) {
    throw new AiUpstreamError(
      adapter,
      0,
      `Request failed: ${(error as Error)?.name ?? "Error"}`,
    );
  }
  const { requestId } = response;
  if (!response.ok) {
    // The (capped) body is never logged or surfaced: provider error bodies
    // can echo prompt content.
    throw new AiUpstreamError(
      adapter,
      response.status,
      `Provider returned HTTP ${response.status}`,
      requestId,
      hintFromErrorBody(response.body),
    );
  }
  if (response.body === null) {
    throw new AiUpstreamError(
      adapter,
      response.status,
      "Provider response was too large",
      requestId,
    );
  }
  try {
    return JSON.parse(response.body.toString("utf8"));
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
