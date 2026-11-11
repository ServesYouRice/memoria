import { beforeEach, describe, expect, it, vi } from "vitest";
import { ItemType } from "@/generated/prisma/enums";
import {
  declaredTypeMatches,
  detectUploadType,
} from "@/lib/uploads/file-types";
import { buildNoteDocument, parseNoteDraft } from "@/lib/uploads/note-draft";
import { parseCanvasItemContent } from "@/lib/validation/canvas-item";

const mocks = vi.hoisted(() => ({
  readImageText: vi.fn(),
  transcribeAudio: vi.fn(),
  generateText: vi.fn(),
  findCanvas: vi.fn(),
  readPrivateUploadObject: vi.fn(),
  getAiAvailability: vi.fn(),
}));

vi.mock("@/lib/ai/service", () => ({
  readImageText: mocks.readImageText,
  transcribeAudio: mocks.transcribeAudio,
  generateText: mocks.generateText,
}));
vi.mock("@/lib/uploads/private-storage", () => ({
  readPrivateUploadObject: mocks.readPrivateUploadObject,
}));
vi.mock("@/lib/ai/provider-resolution", () => ({
  getAiAvailability: mocks.getAiAvailability,
}));
vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));
vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(),
}));
vi.mock("@/lib/canvas/mutation-lock", () => ({
  lockCanvasForMutation: vi.fn(),
}));
vi.mock("@/lib/policy/capacity", () => ({
  assertCanvasItemCapacity: vi.fn(),
}));
vi.mock("@/lib/collaboration/committed-events", () => ({
  recordCanvasItemEvent: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import {
  createUploadNoteHandler,
  getUploadNoteOffers,
  uploadNoteCapability,
} from "@/lib/uploads/upload-note";
import { resetAiBudgetForTests } from "@/lib/ai/budget";
import { AiBudgetError, AiProviderError } from "@/lib/ai/errors";
import { pngBytes } from "../helpers/image-fixtures";

function bytes(...values: number[]) {
  return new Uint8Array([...values, ...new Array(16).fill(0)]);
}

describe("upload file types", () => {
  it("detects voice recordings from their containers", () => {
    expect(detectUploadType(bytes(0x1a, 0x45, 0xdf, 0xa3))?.mime).toBe(
      "audio/webm",
    );
    expect(
      detectUploadType(Buffer.from("OggS\0\0\0\0\0\0\0\0\0\0"))?.mime,
    ).toBe("audio/ogg");
    expect(
      detectUploadType(Buffer.from("\0\0\0\x1cftypM4A \0\0\0\0"))?.mime,
    ).toBe("audio/mp4");
    expect(detectUploadType(Buffer.from("ID3\x04\0\0\0\0\0\0\0\0"))?.mime).toBe(
      "audio/mpeg",
    );
    expect(detectUploadType(Buffer.from("RIFF\0\0\0\0WAVEfmt "))?.mime).toBe(
      "audio/wav",
    );
    expect(detectUploadType(pngBytes(4, 4))).toMatchObject({
      kind: "image",
      mime: "image/png",
    });
  });

  it("does not take HEIF photos or unknown bytes for audio", () => {
    expect(
      detectUploadType(Buffer.from("\0\0\0\x18ftypheic\0\0\0\0")),
    ).toBeNull();
    expect(detectUploadType(Buffer.from("<svg xmlns=...>"))).toBeNull();
  });

  it("accepts browser aliases and codec parameters but not other types", () => {
    const webm = detectUploadType(bytes(0x1a, 0x45, 0xdf, 0xa3))!;
    expect(declaredTypeMatches("audio/webm;codecs=opus", webm)).toBe(true);
    expect(declaredTypeMatches("", webm)).toBe(true);
    expect(declaredTypeMatches("image/png", webm)).toBe(false);
    const png = detectUploadType(pngBytes(4, 4))!;
    expect(declaredTypeMatches("image/png", png)).toBe(true);
    expect(declaredTypeMatches("image/jpeg", png)).toBe(false);
  });

  it("maps stored types to the capability that reads them", () => {
    expect(uploadNoteCapability("audio/webm")).toBe("speechToText");
    expect(uploadNoteCapability("image/jpeg")).toBe("readImage");
    expect(uploadNoteCapability("application/pdf")).toBeNull();
  });
});

describe("note drafts", () => {
  it("turns a write-up into a titled note that links to the original", () => {
    const draft = parseNoteDraft(
      "\n# Title: **Team retro**\n\nWhat went well\nShipped on time\n\n- Fix CI\n- Book room\n\n1. First\n2. Second",
      "Photo note",
    );
    expect(draft.title).toBe("Team retro");
    const content = parseCanvasItemContent(
      ItemType.NOTE,
      buildNoteDocument({
        draft,
        originalUrl: "/api/v1/uploads/cabc",
        originalLabel: "board.jpg",
        emptyBody: "Nothing found.",
      }),
    ) as {
      document: { content: Array<{ type: string; attrs?: unknown }> };
      text: string;
      plainText: string;
    };
    expect(content.document.content.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "bulletList",
      "orderedList",
      "paragraph",
    ]);
    expect(content.document.content[0]!.attrs).toEqual({ level: 2 });
    expect(content.text).toContain('href="/api/v1/uploads/cabc"');
    expect(content.plainText).toContain("Shipped on time");
  });

  it("falls back to a title and an explicit empty body", () => {
    const draft = parseNoteDraft("   ", "Voice note");
    expect(draft).toEqual({ title: "Voice note", body: "" });
    const content = parseCanvasItemContent(
      ItemType.NOTE,
      buildNoteDocument({
        draft,
        originalUrl: "/api/v1/uploads/cabc",
        originalLabel: "voice recording",
        emptyBody: "No speech was recognized in this recording.",
      }),
    ) as { plainText: string };
    expect(content.plainText).toContain("No speech was recognized");
  });

  it("keeps a long write-up within note limits", () => {
    const draft = parseNoteDraft(
      `Long\n\n${"word ".repeat(5000)}\n${"- item\n".repeat(800)}`,
      "x",
    );
    expect(() =>
      parseCanvasItemContent(
        ItemType.NOTE,
        buildNoteDocument({
          draft,
          originalUrl: "/api/v1/uploads/cabc",
          originalLabel: "a.png",
          emptyBody: "-",
        }),
      ),
    ).not.toThrow();
  });
});

describe("upload.note handler", () => {
  const ASSET_ID = "c" + "a".repeat(24);
  const asset = {
    id: ASSET_ID,
    userId: "user-1",
    canvasId: "canvas-1",
    storageKey: "uploads/user-1/x.png",
    storageMode: "local",
    filename: "receipt.png",
    mimeType: "image/png",
    size: 64,
    status: "ACTIVE",
    noteItemId: null as string | null,
  };
  let created: Array<Record<string, unknown>>;

  function fakePrisma() {
    const tx = {
      // The in-transaction access recheck reads the canvas owner and then the
      // share row (FOR SHARE); both answer from the same mocked canvas.
      canvas: { findUnique: mocks.findCanvas },
      $queryRaw: vi.fn(
        async () => ((await mocks.findCanvas()) ?? { shares: [] }).shares,
      ),
      uploadAsset: {
        findUnique: vi.fn(async () => ({
          status: asset.status,
          noteItemId: asset.noteItemId,
        })),
        update: vi.fn(async ({ data }: { data: { noteItemId: string } }) => {
          asset.noteItemId = data.noteItemId;
        }),
      },
      canvasItem: {
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
        aggregate: vi.fn(async () => ({ _max: { zIndex: 3 } })),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: `note-${created.length}`, version: 1 };
        }),
      },
    };
    return {
      uploadAsset: { findUnique: vi.fn(async () => ({ ...asset })) },
      canvas: { findUnique: mocks.findCanvas },
      $transaction: vi.fn(async (run: (store: typeof tx) => unknown) =>
        run(tx),
      ),
    } as never;
  }

  function job(payload: Record<string, unknown> = {}) {
    return {
      id: "job-1",
      type: "upload.note",
      payload: { assetId: ASSET_ID, requestedById: "user-1", ...payload },
    } as never;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetAiBudgetForTests();
    asset.noteItemId = null;
    asset.mimeType = "image/png";
    created = [];
    mocks.findCanvas.mockResolvedValue({ userId: "user-1", shares: [] });
    mocks.readPrivateUploadObject.mockImplementation(async () => ({
      body: new Blob([new Uint8Array(pngBytes(8, 8))]).stream(),
      etag: "e",
    }));
  });

  it("reads a photo with the mocked image reader and records the note once", async () => {
    mocks.readImageText.mockResolvedValue("Receipt\n\n- Tea 2.50");
    const handler = createUploadNoteHandler(fakePrisma());
    await handler(job({ positionX: 10, positionY: 20 }));
    await handler(job({ positionX: 10, positionY: 20 }));

    expect(mocks.readImageText).toHaveBeenCalledTimes(1);
    expect(mocks.readImageText.mock.calls[0]![0]).toMatchObject({
      userId: "user-1",
      mimeType: "image/png",
    });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      type: ItemType.NOTE,
      positionX: 10,
      positionY: 20,
      zIndex: 4,
      createdById: "user-1",
    });
    expect(asset.noteItemId).toBe("note-1");
  });

  it("transcribes audio with the mocked transcriber, then tidies the transcript", async () => {
    asset.mimeType = "audio/webm";
    mocks.transcribeAudio.mockResolvedValue("uh buy some milk");
    mocks.generateText.mockResolvedValue("Milk\n\nBuy some milk.");
    const handler = createUploadNoteHandler(fakePrisma());
    await handler(job());
    expect(mocks.transcribeAudio).toHaveBeenCalledTimes(1);
    expect(mocks.generateText.mock.calls[0]![0].prompt).toContain(
      "uh buy some milk",
    );
    expect(created[0]!.tags).toEqual(["ai-generated", "voice-note"]);
    expect(JSON.stringify(created[0]!.content)).toContain("Buy some milk.");
  });

  it("skips the tidy-up call for a silent recording", async () => {
    asset.mimeType = "audio/webm";
    mocks.transcribeAudio.mockResolvedValue("  ");
    await createUploadNoteHandler(fakePrisma())(job());
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(JSON.stringify(created[0]!.content)).toContain(
      "No speech was recognized",
    );
  });

  it("stops retrying on a daily budget or a rejected key, but retries a provider hiccup", async () => {
    const handler = createUploadNoteHandler(fakePrisma());
    mocks.readImageText.mockRejectedValueOnce(
      new AiBudgetError("AI_TOKEN_BUDGET", "Daily allowance reached", 60),
    );
    await expect(handler(job())).rejects.toMatchObject({
      retryable: false,
      message: "Daily allowance reached",
    });
    mocks.readImageText.mockRejectedValueOnce(
      new AiProviderError(
        "The AI provider rejected the saved key. Update it in Settings.",
      ),
    );
    await expect(handler(job())).rejects.toMatchObject({ retryable: false });
    mocks.readImageText.mockRejectedValueOnce(new AiProviderError());
    await expect(handler(job())).rejects.toMatchObject({ retryable: true });
    expect(created).toHaveLength(0);
  });

  it("refuses a requester who can no longer edit the canvas", async () => {
    mocks.findCanvas.mockResolvedValue({
      userId: "owner",
      shares: [{ role: "VIEW" }],
    });
    await expect(
      createUploadNoteHandler(fakePrisma())(job()),
    ).rejects.toMatchObject({ retryable: false });
    expect(mocks.readImageText).not.toHaveBeenCalled();

    // An editor the canvas is shared with may still make the note.
    mocks.findCanvas.mockResolvedValue({
      userId: "owner",
      shares: [{ role: "EDIT" }],
    });
    mocks.readImageText.mockResolvedValue("Shared\n\nok");
    await createUploadNoteHandler(fakePrisma())(job());
    expect(created).toHaveLength(1);
  });

  it("writes no note when edit access is revoked during the AI call", async () => {
    mocks.findCanvas.mockResolvedValue({
      userId: "owner",
      shares: [{ role: "EDIT" }],
    });
    mocks.readImageText.mockImplementation(async () => {
      mocks.findCanvas.mockResolvedValue({ userId: "owner", shares: [] });
      return "Shared\n\nok";
    });
    await expect(
      createUploadNoteHandler(fakePrisma())(job()),
    ).rejects.toMatchObject({
      retryable: false,
      message: "The requester can no longer edit this canvas",
    });
    expect(created).toHaveLength(0);
  });

  it("cancels a stalled storage read when the worker aborts the job", async () => {
    const cancelled = vi.fn();
    mocks.readPrivateUploadObject.mockImplementation(async () => ({
      // A body that never delivers a chunk, like a stalled S3 response.
      body: new ReadableStream<Uint8Array>({
        pull: () => new Promise<void>(() => undefined),
        cancel: cancelled,
      }),
      etag: "e",
    }));
    const controller = new AbortController();
    const run = createUploadNoteHandler(fakePrisma())(job(), {
      signal: controller.signal,
    } as never);
    const outcome = run.then(
      () => "resolved",
      () => "rejected",
    );
    await vi.waitFor(() =>
      expect(mocks.readPrivateUploadObject).toHaveBeenCalled(),
    );
    expect(mocks.readPrivateUploadObject.mock.calls[0]![2]).toBe(
      controller.signal,
    );
    controller.abort(new Error("job timed out"));
    const settled = await Promise.race([
      outcome,
      new Promise((resolve) => setTimeout(() => resolve("hung"), 500)),
    ]);
    expect(settled).toBe("rejected");
    expect(cancelled).toHaveBeenCalled();
    expect(mocks.readImageText).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it("applies the AI budget to the job", async () => {
    vi.stubEnv("AI_DAILY_TOKEN_BUDGET", "100");
    try {
      mocks.readImageText.mockResolvedValue("x");
      await expect(
        createUploadNoteHandler(fakePrisma())(job()),
      ).rejects.toMatchObject({ retryable: false });
      expect(mocks.readImageText).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("upload note offers", () => {
  it("follows the saved provider's capabilities", async () => {
    mocks.getAiAvailability.mockResolvedValue({
      configured: true,
      capabilities: {
        chat: true,
        readImage: true,
        speechToText: false,
        embeddings: false,
      },
    });
    await expect(getUploadNoteOffers("user-1")).resolves.toEqual({
      readImage: true,
      speechToText: false,
    });
    mocks.getAiAvailability.mockResolvedValue({
      configured: false,
      capabilities: null,
    });
    await expect(getUploadNoteOffers("user-1")).resolves.toEqual({
      readImage: false,
      speechToText: false,
    });
  });
});
