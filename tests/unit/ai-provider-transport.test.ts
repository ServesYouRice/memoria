import { EventEmitter } from "events";
import type * as DnsModule from "dns";
import type * as HttpsModule from "https";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock, requestMock, findMany } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
  requestMock: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("dns", async (importOriginal) => {
  const actual = await importOriginal<typeof DnsModule>();
  return { ...actual, promises: { ...actual.promises, lookup: lookupMock } };
});

vi.mock("https", async (importOriginal) => {
  const actual = await importOriginal<typeof HttpsModule>();
  return {
    ...actual,
    request: requestMock,
    default: { ...actual.default, request: requestMock },
  };
});

vi.mock("@/lib/db", () => ({
  prisma: { modelCredential: { findMany, updateMany: vi.fn() } },
}));

import { encryptSecret } from "@/lib/agents/crypto";
import { BUILTIN_AI_CAPABILITY } from "@/lib/ai/provider-resolution";
import * as transport from "@/lib/ai/providers/types";
import { generateText } from "@/lib/ai/service";
import { AiProviderError } from "@/lib/ai/errors";

// 1 MB, the pinned client's default, until the transport exports its cap.
const AI_PROVIDER_MAX_RESPONSE_BYTES =
  ((transport as Record<string, unknown>).AI_PROVIDER_MAX_RESPONSE_BYTES as
    number | undefined) ?? 1024 * 1024;

const chat = (content: string) =>
  JSON.stringify({ choices: [{ message: { content } }] });

/** A ClientRequest stub replying once with `status` and the given chunks. */
function respondWith(
  status: number,
  chunks: Buffer[],
  headers: Record<string, string> = {},
) {
  return (_options: unknown, callback: (res: EventEmitter) => void) => {
    const res = new EventEmitter() as EventEmitter & {
      statusCode: number;
      headers: Record<string, string>;
    };
    res.statusCode = status;
    res.headers = headers;
    const req = new EventEmitter() as EventEmitter & Record<string, unknown>;
    let destroyed = false;
    req["end"] = vi.fn();
    req["write"] = vi.fn();
    req["destroy"] = vi.fn(() => {
      destroyed = true;
    });
    req["setTimeout"] = vi.fn();
    process.nextTick(() => {
      callback(res);
      let index = 0;
      const next = () => {
        if (destroyed) return;
        if (index < chunks.length) {
          res.emit("data", chunks[index++]);
          process.nextTick(next);
        } else {
          res.emit("end");
        }
      };
      process.nextTick(next);
    });
    return req;
  };
}

function savedCredential(overrides: Record<string, unknown> = {}) {
  return {
    id: "cred-1",
    provider: "OPENAI_COMPAT",
    baseUrl: "https://llm.example.com/v1",
    defaultModel: "llama3",
    encryptedSecret: encryptSecret("sk-user"),
    secretFingerprint: "fp-user",
    capabilities: [BUILTIN_AI_CAPABILITY],
    ...overrides,
  };
}

/** A streamed fetch Response that counts how many chunks were pulled. */
function streamedResponse(status: number, chunk: string, count: number) {
  const encoded = new TextEncoder().encode(chunk);
  const pulled = { count: 0 };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled.count >= count) {
        controller.close();
        return;
      }
      pulled.count += 1;
      controller.enqueue(encoded);
    },
  });
  return { response: new Response(body, { status }), pulled };
}

describe("AI provider transport", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AI_ALLOW_PRIVATE_BASE_URLS", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(async () => new Response(chat("via fetch")));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("connects a custom base URL to the address the SSRF check validated", async () => {
    findMany.mockResolvedValue([savedCredential()]);
    lookupMock
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    requestMock.mockImplementation(
      respondWith(200, [Buffer.from(chat("pinned"))]),
    );

    await expect(
      generateText({ prompt: "Hi", userId: "user-1" }),
    ).resolves.toBe("pinned");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(requestMock).toHaveBeenCalledTimes(1);
    const options = requestMock.mock.calls[0]![0] as Record<string, any>;
    expect(options.hostname).toBe("93.184.216.34");
    expect(options.servername).toBe("llm.example.com");
    expect(options.method).toBe("POST");
    expect(options.path).toBe("/v1/chat/completions");
    expect(options.headers.Host).toBe("llm.example.com");
    expect(options.headers.authorization).toBe("Bearer sk-user");
    await new Promise<void>((resolve) =>
      options.lookup("llm.example.com", {}, (_e: unknown, address: string) => {
        expect(address).toBe("93.184.216.34");
        resolve();
      }),
    );
  });

  it("refuses an oversized response on the pinned path", async () => {
    findMany.mockResolvedValue([savedCredential()]);
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const chunk = Buffer.alloc(64 * 1024, "a");
    const chunks = Array.from(
      { length: Math.ceil(AI_PROVIDER_MAX_RESPONSE_BYTES / chunk.length) + 4 },
      () => chunk,
    );
    requestMock.mockImplementation(respondWith(200, chunks));
    await expect(
      generateText({ prompt: "Hi", userId: "user-1" }),
    ).rejects.toBeInstanceOf(AiProviderError);

    requestMock.mockImplementation(
      respondWith(200, [Buffer.from(chat("ok"))], {
        "content-length": String(AI_PROVIDER_MAX_RESPONSE_BYTES + 1),
      }),
    );
    await expect(
      generateText({ prompt: "Hi", userId: "user-1" }),
    ).rejects.toBeInstanceOf(AiProviderError);
  });

  it("stops reading a streamed success body past the cap", async () => {
    findMany.mockResolvedValue([
      savedCredential({
        provider: "OPENAI",
        baseUrl: null,
        defaultModel: "gpt-4o-mini",
      }),
    ]);
    const chunk = "a".repeat(64 * 1024);
    const total = Math.ceil(AI_PROVIDER_MAX_RESPONSE_BYTES / chunk.length) * 3;
    const prefix = '{"choices":[{"message":{"content":"';
    let first = true;
    const pulled = { count: 0 };
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled.count >= total) {
          controller.enqueue(new TextEncoder().encode('"}}]}'));
          controller.close();
          return;
        }
        pulled.count += 1;
        controller.enqueue(
          new TextEncoder().encode(first ? prefix + chunk : chunk),
        );
        first = false;
      },
    });
    fetchMock.mockImplementation(async () => new Response(body));

    await expect(
      generateText({ prompt: "Hi", userId: "user-1" }),
    ).rejects.toBeInstanceOf(AiProviderError);
    expect(pulled.count).toBeLessThan(total);
  });

  it("refuses a declared oversized body and caps streamed error bodies", async () => {
    findMany.mockResolvedValue([
      savedCredential({
        provider: "OPENAI",
        baseUrl: null,
        defaultModel: "gpt-4o-mini",
      }),
    ]);
    fetchMock.mockImplementation(
      async () =>
        new Response(chat("ok"), {
          headers: {
            "content-length": String(AI_PROVIDER_MAX_RESPONSE_BYTES + 1),
          },
        }),
    );
    await expect(
      generateText({ prompt: "Hi", userId: "user-1" }),
    ).rejects.toBeInstanceOf(AiProviderError);

    const chunk = "e".repeat(64 * 1024);
    const total = Math.ceil(AI_PROVIDER_MAX_RESPONSE_BYTES / chunk.length) * 3;
    const streamed = streamedResponse(500, chunk, total);
    fetchMock.mockImplementation(async () => streamed.response);
    await expect(
      generateText({ prompt: "Hi", userId: "user-1" }),
    ).rejects.toMatchObject({ status: 502 });
    expect(streamed.pulled.count).toBeLessThan(total);
  });

  it("still parses a normal body", async () => {
    findMany.mockResolvedValue([
      savedCredential({
        provider: "OPENAI",
        baseUrl: null,
        defaultModel: "gpt-4o-mini",
      }),
    ]);
    await expect(
      generateText({ prompt: "Hi", userId: "user-1" }),
    ).resolves.toBe("via fetch");
  });
});
