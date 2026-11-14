/**
 * IMP-114: video cards keep notes at moments and a transcript. Pasted
 * transcripts are found by search and Ask; automatic caption reading only
 * happens when the deployment switches it on; both go with their item.
 */
import { randomBytes } from "crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

const session = vi.hoisted(() => ({ user: { id: "", email: "" } }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => session) }));
vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));
vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));

import { GET as search } from "@/app/api/v1/search/route";
import { GET as searchCanvas } from "@/app/api/v1/canvas-items/search/route";
import { POST as createItem } from "@/app/api/v1/canvas-items/route";
import { GET as readVideo } from "@/app/api/v1/canvas-items/[itemId]/video/route";
import { POST as addNote } from "@/app/api/v1/canvas-items/[itemId]/video/notes/route";
import { PUT as pasteTranscript } from "@/app/api/v1/canvas-items/[itemId]/video/transcript/route";
import { retrieveOwnedItems, searchOwnedItems } from "@/lib/ai/ask";
import {
  VIDEO_TRANSCRIPT_JOB,
  createVideoTranscriptHandler,
} from "@/lib/video/video-items";
import type { OutboxJob } from "@/lib/outbox/types";

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function fixture() {
  const tag = randomBytes(6).toString("hex");
  const user = await prisma.user.create({
    data: { email: `video-${tag}@example.com` },
  });
  session.user = { id: user.id, email: user.email };
  const canvas = await prisma.canvas.create({
    data: { name: "Talks", userId: user.id },
  });
  const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  const video = await prisma.canvasItem.create({
    data: {
      canvasId: canvas.id,
      type: "BOOKMARK",
      positionX: 0,
      positionY: 0,
      width: 300,
      height: 100,
      content: { url, title: "A talk", siteName: "YouTube" },
      createdById: user.id,
    },
  });
  return { tag, user, canvas, video, url };
}

function json(path: string, method: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("video notes and transcripts (IMP-114)", () => {
  it("finds words that appear only in a pasted transcript, in search and Ask", async () => {
    const { tag, user, canvas, video } = await fixture();
    const word = `quokka${tag}`;
    const params = { params: Promise.resolve({ itemId: video.id }) };

    const pasted = await pasteTranscript(
      json(`/api/v1/canvas-items/${video.id}/video/transcript`, "PUT", {
        text: `0:05 Welcome.\n1:10 The ${word} lives on an island.`,
      }),
      params,
    );
    expect(pasted.status).toBe(200);

    const global = await search(
      new Request(`http://localhost/api/v1/search?q=${word}`),
    );
    const body = await global.json();
    expect(body.results.map((r: { itemId: string }) => r.itemId)).toEqual([
      video.id,
    ]);
    expect(body.results[0].snippet).toContain(`The ${word} lives`);

    const local = await searchCanvas(
      new Request(
        `http://localhost/api/v1/canvas-items/search?canvasId=${canvas.id}&q=${word}`,
      ),
    );
    expect((await local.json()).itemIds).toEqual([video.id]);

    const rows = await searchOwnedItems(user.id, [word]);
    expect(rows.map((row) => row.id)).toEqual([video.id]);
    const [retrieved] = await retrieveOwnedItems(user.id, `where is ${word}`);
    expect(retrieved?.transcript).toContain(`The ${word} lives`);
  });

  it("keeps a note at a moment, and deletes notes and transcript with the item", async () => {
    const { video } = await fixture();
    const params = { params: Promise.resolve({ itemId: video.id }) };
    const added = await addNote(
      json(`/api/v1/canvas-items/${video.id}/video/notes`, "POST", {
        seconds: 75,
        text: "The key point",
      }),
      params,
    );
    expect(added.status).toBe(201);
    await pasteTranscript(
      json(`/api/v1/canvas-items/${video.id}/video/transcript`, "PUT", {
        text: "Some words",
      }),
      params,
    );

    const read = await readVideo(
      new NextRequest(`http://localhost/api/v1/canvas-items/${video.id}/video`),
      params,
    );
    const card = await read.json();
    expect(card.video).toMatchObject({ title: "A talk", source: "YouTube" });
    expect(card.notes).toEqual([
      expect.objectContaining({
        seconds: 75,
        text: "The key point",
        openUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=75s",
      }),
    ]);
    expect(card.transcript).toMatchObject({
      text: "Some words",
      source: "pasted",
    });

    await prisma.canvasItem.delete({ where: { id: video.id } });
    await expect(
      prisma.itemVideoNote.count({ where: { itemId: video.id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.itemTranscript.findUnique({ where: { itemId: video.id } }),
    ).resolves.toBeNull();
  });

  it("reads captions only when the deployment switches it on", async () => {
    const { canvas, url } = await fixture();
    const save = () =>
      createItem(
        json("/api/v1/canvas-items", "POST", {
          canvasId: canvas.id,
          type: "BOOKMARK",
          positionX: 0,
          positionY: 0,
          width: 300,
          height: 100,
          content: { url },
        }),
      );

    const off = await (await save()).json();
    await expect(
      prisma.outboxJob.count({
        where: {
          type: VIDEO_TRANSCRIPT_JOB,
          payload: { equals: { itemId: off.id } },
        },
      }),
    ).resolves.toBe(0);

    vi.stubEnv("VIDEO_TRANSCRIPT_FETCH", "true");
    const on = await (await save()).json();
    const queued = await prisma.outboxJob.findFirstOrThrow({
      where: { dedupeKey: `${VIDEO_TRANSCRIPT_JOB}:${on.id}:dQw4w9WgXcQ` },
    });

    const fetchCaptions = vi.fn(async () => ({
      ok: true as const,
      text: "0:01 Public captions.",
      language: "en",
    }));
    const handler = createVideoTranscriptHandler(prisma, { fetchCaptions });
    const job = { ...queued, attempts: 1 } as OutboxJob;
    await handler(job);
    await handler(job);
    expect(fetchCaptions).toHaveBeenCalledTimes(1);
    await expect(
      prisma.itemTranscript.findUniqueOrThrow({ where: { itemId: on.id } }),
    ).resolves.toMatchObject({
      text: "0:01 Public captions.",
      source: "FETCHED",
      url,
    });

    // With the switch off again, the job reads nothing.
    vi.stubEnv("VIDEO_TRANSCRIPT_FETCH", "false");
    const quiet = vi.fn();
    await createVideoTranscriptHandler(prisma, { fetchCaptions: quiet })({
      ...job,
      payload: { itemId: off.id },
    } as OutboxJob);
    expect(quiet).not.toHaveBeenCalled();
    await expect(
      prisma.itemTranscript.findUnique({ where: { itemId: off.id } }),
    ).resolves.toBeNull();
  });
});
