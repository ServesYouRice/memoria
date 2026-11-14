import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getCachedSession: vi.fn(),
  requireItemAccess: vi.fn(),
  findItem: vi.fn(),
  findCanvas: vi.fn(),
  createJobs: vi.fn(),
  queryRaw: vi.fn(async () => [{ locked: 1 }]),
  noteCount: vi.fn(async () => 0),
  noteCreate: vi.fn(),
  noteDeleteMany: vi.fn(),
  transcriptAggregate: vi.fn(async () => ({ _sum: { textBytes: 0 } })),
  transcriptUpsert: vi.fn(),
}));

vi.mock("@/lib/api/session-cache", () => ({
  getCachedSession: mocks.getCachedSession,
  runWithSessionCache: (fn: () => unknown) => fn(),
}));
vi.mock("@/lib/api/auth", () => ({
  requireItemAccess: mocks.requireItemAccess,
}));
vi.mock("@/lib/db", () => {
  const prisma: Record<string, unknown> = {
    $queryRaw: mocks.queryRaw,
    canvasItem: { findFirst: mocks.findItem },
    canvas: { findUnique: mocks.findCanvas },
    outboxJob: { createMany: mocks.createJobs },
    itemVideoNote: {
      count: mocks.noteCount,
      create: mocks.noteCreate,
      deleteMany: mocks.noteDeleteMany,
    },
    itemTranscript: {
      aggregate: mocks.transcriptAggregate,
      upsert: mocks.transcriptUpsert,
    },
  };
  prisma.$transaction = async (callback: (tx: unknown) => unknown) =>
    callback(prisma);
  return { prisma };
});

import { GET } from "@/app/api/v1/canvas-items/[itemId]/video/route";
import { POST as addNote } from "@/app/api/v1/canvas-items/[itemId]/video/notes/route";
import { DELETE as deleteNote } from "@/app/api/v1/canvas-items/[itemId]/video/notes/[noteId]/route";
import {
  DELETE as clearTranscript,
  PUT as pasteTranscript,
} from "@/app/api/v1/canvas-items/[itemId]/video/transcript/route";
import { VIDEO_BUDGET } from "@/lib/video/video-items";

const VIDEO = "https://youtu.be/dQw4w9WgXcQ";
const base = "http://localhost/api/v1/canvas-items/item-1/video";
const params = { params: Promise.resolve({ itemId: "item-1" }) };

function read() {
  return GET(new NextRequest(base), params);
}

function send(
  handler: (request: NextRequest, context: unknown) => Promise<Response>,
  path: string,
  method: string,
  body?: unknown,
  context: unknown = params,
) {
  return handler(
    new NextRequest(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    context,
  );
}

function videoItem(extra: Record<string, unknown> = {}) {
  return {
    type: "BOOKMARK",
    content: { url: VIDEO, title: "A talk" },
    canvasId: "canvas-1",
    canvas: { userId: "owner" },
    videoNotes: [
      {
        id: "n1",
        seconds: 65,
        text: "<b>Key point</b>",
        authorId: "u1",
        createdAt: new Date("2026-11-01T10:00:00Z"),
      },
    ],
    transcript: null,
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mocks.getCachedSession.mockResolvedValue({
    user: { id: "u1", email: "u1@example.com" },
  });
  mocks.requireItemAccess.mockResolvedValue("EDIT");
  mocks.findCanvas.mockResolvedValue({ user: { autoEnrichLinks: true } });
  mocks.findItem.mockResolvedValue(videoItem());
});

describe("GET /api/v1/canvas-items/{itemId}/video (IMP-114)", () => {
  it("checks that the person may view the canvas", async () => {
    const { ForbiddenError } = await import("@/lib/errors");
    mocks.requireItemAccess.mockRejectedValue(new ForbiddenError("No"));
    expect((await read()).status).toBe(403);
    expect(mocks.requireItemAccess).toHaveBeenCalledWith(
      "item-1",
      "u1",
      "u1@example.com",
      "VIEW",
    );
    expect(mocks.findItem).not.toHaveBeenCalled();
  });

  it("returns the title, source, notes with their moment links, and the transcript", async () => {
    mocks.requireItemAccess.mockResolvedValue("VIEW");
    mocks.findItem.mockResolvedValue(
      videoItem({
        transcript: {
          url: VIDEO,
          text: "0:05 <script>x</script> words",
          source: "PASTED",
          language: null,
          fetchedAt: null,
          updatedAt: new Date("2026-11-02T10:00:00Z"),
        },
      }),
    );
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      video: {
        url: VIDEO,
        provider: "youtube",
        source: "YouTube",
        host: "youtu.be",
        title: "A talk",
      },
      notes: [
        {
          id: "n1",
          seconds: 65,
          text: "<b>Key point</b>",
          openUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=65s",
          mine: true,
          createdAt: "2026-11-01T10:00:00.000Z",
        },
      ],
      transcript: {
        text: "0:05 <script>x</script> words",
        source: "pasted",
        language: null,
        updatedAt: "2026-11-02T10:00:00.000Z",
      },
      canEdit: false,
      autoFetch: { enabled: false, pending: false },
      limits: {
        maxNoteChars: VIDEO_BUDGET.maxNoteChars,
        maxTranscriptBytes: VIDEO_BUDGET.maxBytesPerVideo,
      },
    });
    expect(mocks.createJobs).not.toHaveBeenCalled();
  });

  it("does not offer a transcript of an address the card no longer points to", async () => {
    mocks.findItem.mockResolvedValue(
      videoItem({
        transcript: {
          url: "https://youtu.be/aaaaaaaaaaa",
          text: "old",
          source: "PASTED",
          language: null,
          fetchedAt: null,
          updatedAt: new Date(),
        },
      }),
    );
    expect((await (await read()).json()).transcript).toBeNull();
  });

  it("is 404 for anything but a live video card", async () => {
    mocks.findItem.mockResolvedValue(null);
    expect((await read()).status).toBe(404);
    mocks.findItem.mockResolvedValue(
      videoItem({ content: { url: "https://news.example/" } }),
    );
    expect((await read()).status).toBe(404);
    mocks.findItem.mockResolvedValue(videoItem({ type: "NOTE" }));
    expect((await read()).status).toBe(404);
  });

  it("queues the caption read only when the deployment switch is on", async () => {
    expect((await (await read()).json()).autoFetch).toEqual({
      enabled: false,
      pending: false,
    });
    expect(mocks.createJobs).not.toHaveBeenCalled();

    vi.stubEnv("VIDEO_TRANSCRIPT_FETCH", "true");
    expect((await (await read()).json()).autoFetch).toEqual({
      enabled: true,
      pending: true,
    });
    expect(mocks.createJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            type: "video.transcript",
            dedupeKey: "video.transcript:item-1:dQw4w9WgXcQ",
          }),
        ],
      }),
    );
  });
});

describe("POST /api/v1/canvas-items/{itemId}/video/notes", () => {
  it("adds a note at a moment for people who may edit", async () => {
    mocks.noteCreate.mockResolvedValue({
      id: "n2",
      seconds: 90,
      text: "Here",
      createdAt: new Date("2026-11-03T10:00:00Z"),
    });
    const response = await send(addNote, "/notes", "POST", {
      seconds: 90,
      text: "  Here  ",
    });
    expect(response.status).toBe(201);
    expect(mocks.requireItemAccess).toHaveBeenCalledWith(
      "item-1",
      "u1",
      "u1@example.com",
      "EDIT",
    );
    expect(mocks.noteCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { itemId: "item-1", authorId: "u1", seconds: 90, text: "Here" },
      }),
    );
    expect(await response.json()).toMatchObject({
      id: "n2",
      openUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s",
    });
  });

  it("refuses viewers, bad times and empty notes", async () => {
    const { ForbiddenError } = await import("@/lib/errors");
    mocks.requireItemAccess.mockRejectedValueOnce(new ForbiddenError("No"));
    expect(
      (await send(addNote, "/notes", "POST", { seconds: 1, text: "x" })).status,
    ).toBe(403);
    for (const body of [
      { seconds: -1, text: "x" },
      { seconds: 1.5, text: "x" },
      { seconds: 1, text: "   " },
      { seconds: 1, text: "x".repeat(VIDEO_BUDGET.maxNoteChars + 1) },
      { seconds: 1, text: "x", authorId: "someone-else" },
    ]) {
      expect((await send(addNote, "/notes", "POST", body)).status).toBe(400);
    }
    expect(mocks.noteCreate).not.toHaveBeenCalled();
  });

  it("refuses a note past the per-video limit", async () => {
    mocks.noteCount.mockResolvedValueOnce(VIDEO_BUDGET.maxNotesPerVideo);
    const response = await send(addNote, "/notes", "POST", {
      seconds: 1,
      text: "x",
    });
    expect(response.status).toBe(422);
    expect(mocks.noteCreate).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/v1/canvas-items/{itemId}/video/notes/{noteId}", () => {
  const noteParams = {
    params: Promise.resolve({ itemId: "item-1", noteId: "n1" }),
  };

  it("removes a note of this video only", async () => {
    mocks.noteDeleteMany.mockResolvedValueOnce({ count: 1 });
    const response = await send(
      deleteNote,
      "/notes/n1",
      "DELETE",
      undefined,
      noteParams,
    );
    expect(response.status).toBe(204);
    expect(mocks.noteDeleteMany).toHaveBeenCalledWith({
      where: { id: "n1", itemId: "item-1", item: { deletedAt: null } },
    });
    mocks.noteDeleteMany.mockResolvedValueOnce({ count: 0 });
    expect(
      (await send(deleteNote, "/notes/n1", "DELETE", undefined, noteParams))
        .status,
    ).toBe(404);
  });
});

describe("PUT and DELETE /api/v1/canvas-items/{itemId}/video/transcript", () => {
  it("keeps a pasted transcript against the canvas owner's budget", async () => {
    const response = await send(pasteTranscript, "/transcript", "PUT", {
      text: "  0:05 The quokka.  ",
    });
    expect(response.status).toBe(200);
    expect(mocks.transcriptUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { itemId: "item-1" },
        create: expect.objectContaining({
          userId: "owner",
          url: VIDEO,
          text: "0:05 The quokka.",
          source: "PASTED",
        }),
      }),
    );
  });

  it("refuses empty, oversized and over-budget transcripts", async () => {
    expect(
      (await send(pasteTranscript, "/transcript", "PUT", { text: "  " }))
        .status,
    ).toBe(400);
    // Under the character limit, over the byte limit.
    const wide = "é".repeat(VIDEO_BUDGET.maxBytesPerVideo / 2 + 1);
    expect(
      (await send(pasteTranscript, "/transcript", "PUT", { text: wide }))
        .status,
    ).toBe(400);
    mocks.transcriptAggregate.mockResolvedValueOnce({
      _sum: { textBytes: VIDEO_BUDGET.maxBytesPerAccount },
    });
    expect(
      (await send(pasteTranscript, "/transcript", "PUT", { text: "words" }))
        .status,
    ).toBe(422);
    expect(mocks.transcriptUpsert).not.toHaveBeenCalled();
  });

  it("clears a transcript so it is not read again", async () => {
    const response = await send(
      clearTranscript,
      "/transcript",
      "DELETE",
      undefined,
    );
    expect(response.status).toBe(204);
    expect(mocks.transcriptUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ text: "", source: "PASTED" }),
      }),
    );
  });

  it("needs edit access and a video card", async () => {
    const { ForbiddenError } = await import("@/lib/errors");
    mocks.requireItemAccess.mockRejectedValueOnce(new ForbiddenError("No"));
    expect(
      (await send(pasteTranscript, "/transcript", "PUT", { text: "x" })).status,
    ).toBe(403);
    mocks.findItem.mockResolvedValueOnce(
      videoItem({ content: { url: "https://news.example/" } }),
    );
    expect((await send(clearTranscript, "/transcript", "DELETE")).status).toBe(
      404,
    );
  });
});
