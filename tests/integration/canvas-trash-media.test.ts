import { randomBytes } from "crypto";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// IMP-132 with IMP-110, IMP-113 and IMP-114: a canvas in Trash keeps its PDF
// cards, video notes, transcripts and page captures, but every route that
// reaches them answers exactly as for an id that does not exist, and the
// background reading waits instead of working on deleted content.
const session = vi.hoisted(() => ({
  current: null as null | { user: { id: string; email: string } },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => session.current) }));
vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));
vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));

import { prisma } from "@/lib/db";
import { DELETE as deleteCanvas } from "@/app/api/v1/canvases/[canvasId]/route";
import { POST as restoreCanvas } from "@/app/api/v1/canvases/[canvasId]/restore/route";
import { POST as upload } from "@/app/api/v1/upload/route";
import { GET as readUpload } from "@/app/api/v1/uploads/[assetId]/route";
import { GET as searchCanvas } from "@/app/api/v1/canvas-items/search/route";
import { GET as readVideo } from "@/app/api/v1/canvas-items/[itemId]/video/route";
import { POST as addNote } from "@/app/api/v1/canvas-items/[itemId]/video/notes/route";
import { DELETE as deleteNote } from "@/app/api/v1/canvas-items/[itemId]/video/notes/[noteId]/route";
import {
  DELETE as clearTranscript,
  PUT as pasteTranscript,
} from "@/app/api/v1/canvas-items/[itemId]/video/transcript/route";
import { GET as readPageCapture } from "@/app/api/v1/canvas-items/[itemId]/page-capture/[kind]/route";
import { GET as readPageCopy } from "@/app/api/v1/canvas-items/[itemId]/page-copy/route";
import { createPdfReadHandler } from "@/lib/pdf/outbox-handler";
import { PDF_READ_JOB } from "@/lib/pdf/pdf-items";
import {
  createVideoTranscriptHandler,
  VIDEO_TRANSCRIPT_JOB,
} from "@/lib/video/video-items";
import {
  createPageCaptureHandler,
  PAGE_CAPTURE_JOB,
} from "@/lib/services/page-capture";
import { createTrashRetentionHandler } from "@/lib/retention/outbox-handler";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";
import { OutboxDeferError, type OutboxJob } from "@/lib/outbox/types";
import { pdfBytes } from "../helpers/pdf-fixtures";

const DAY_MS = 86_400_000;
let uploadDir: string;

beforeAll(async () => {
  uploadDir = await mkdtemp(join(tmpdir(), "memoria-trash-media-"));
  vi.stubEnv("UPLOAD_LOCAL_DIR", uploadDir);
  vi.stubEnv("UPLOAD_STORAGE", "local");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(uploadDir, { recursive: true, force: true });
  await prisma.$disconnect();
});

const suffix = () => randomBytes(6).toString("hex");

function as(row: { id: string; email: string }) {
  session.current = { user: { id: row.id, email: row.email } };
}

function req(url: string, init?: { method?: string; body?: unknown }) {
  return new NextRequest(`http://localhost${url}`, {
    method: init?.method ?? "GET",
    ...(init?.body === undefined
      ? {}
      : {
          body: JSON.stringify(init.body),
          headers: { "Content-Type": "application/json" },
        }),
  });
}

/** Status and problem text, without the instance URL that names the id. */
async function problem(response: Response) {
  const body = await response.json().catch(() => null);
  return { status: response.status, title: body?.title, detail: body?.detail };
}

function job(type: string, payload: Record<string, unknown>): OutboxJob {
  return {
    id: `job-${suffix()}`,
    type,
    payload,
    attempts: 1,
    maxAttempts: 4,
  } as OutboxJob;
}

async function storedFile(userId: string, name: string, bytes: Uint8Array) {
  await mkdir(join(uploadDir, userId), { recursive: true });
  await writeFile(join(uploadDir, userId, name), bytes);
  return `uploads/${userId}/${name}`;
}

/** An owner's canvas, shared for editing, with a PDF card, a video with a
 * note and a transcript, and a saved link with a page picture. */
async function seed() {
  const tag = suffix();
  const owner = await prisma.user.create({
    data: { email: `trash-media-${tag}@example.com` },
  });
  const collaborator = await prisma.user.create({
    data: { email: `trash-media-collab-${tag}@example.com` },
  });
  const canvas = await prisma.canvas.create({
    data: {
      name: "Media board",
      userId: owner.id,
      shares: {
        create: {
          email: collaborator.email,
          recipientId: collaborator.id,
          role: "EDIT",
        },
      },
    },
  });
  const word = `okapi${tag}`;
  const pdf = pdfBytes([`The ${word} report`]);
  const pdfAsset = await prisma.uploadAsset.create({
    data: {
      userId: owner.id,
      canvasId: canvas.id,
      storageKey: await storedFile(owner.id, `report-${tag}.pdf`, pdf),
      storageMode: "local",
      filename: "report.pdf",
      mimeType: "application/pdf",
      size: pdf.length,
      status: "ACTIVE",
    },
  });
  const item = (type: "PDF" | "BOOKMARK", content: object) =>
    prisma.canvasItem.create({
      data: {
        canvasId: canvas.id,
        type,
        positionX: 0,
        positionY: 0,
        width: 300,
        height: 120,
        content,
        createdById: owner.id,
      },
    });
  const pdfCard = await item("PDF", {
    assetId: pdfAsset.id,
    filename: "report.pdf",
    size: pdf.length,
  });
  const videoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  const video = await item("BOOKMARK", { url: videoUrl, title: "A talk" });
  const note = await prisma.itemVideoNote.create({
    data: { itemId: video.id, authorId: owner.id, seconds: 5, text: "Here" },
  });
  await prisma.itemTranscript.create({
    data: {
      itemId: video.id,
      userId: owner.id,
      url: videoUrl,
      text: `0:05 The ${word} talk.`,
      textBytes: 20,
      source: "PASTED",
    },
  });
  const linkUrl = `https://news.example/${tag}`;
  const link = await item("BOOKMARK", { url: linkUrl, title: "A story" });
  const picture = Buffer.alloc(100, 1);
  const imageAsset = await prisma.uploadAsset.create({
    data: {
      userId: owner.id,
      canvasId: canvas.id,
      sourceItemId: link.id,
      storageKey: await storedFile(owner.id, `page-${tag}.jpg`, picture),
      storageMode: "local",
      filename: "page.jpg",
      mimeType: "image/jpeg",
      size: picture.length,
      status: "ACTIVE",
    },
  });
  await prisma.itemPageCapture.create({
    data: {
      itemId: link.id,
      userId: owner.id,
      url: linkUrl,
      imageAssetId: imageAsset.id,
      capturedAt: new Date(),
    },
  });
  await prisma.uploadQuota.create({
    data: {
      userId: owner.id,
      assetCount: 2,
      totalBytes: BigInt(pdf.length + picture.length),
    },
  });
  return {
    owner,
    collaborator,
    canvas,
    word,
    pdf,
    pdfAsset,
    pdfCard,
    video,
    note,
    link,
    imageAsset,
  };
}

type Seed = Awaited<ReturnType<typeof seed>>;

/** Every PDF, video and page-capture route, for the seeded ids or others. */
function routes(
  s: Seed,
  ids: {
    canvasId: string;
    assetId: string;
    videoId: string;
    noteId: string;
    linkId: string;
  },
) {
  const item = (itemId: string) => ({ params: Promise.resolve({ itemId }) });
  const form = new FormData();
  form.append(
    "file",
    new File([s.pdf], "report.pdf", { type: "application/pdf" }),
  );
  form.append("canvasId", ids.canvasId);
  form.append("purpose", "pdf");
  return {
    "PDF upload": () =>
      upload(
        new NextRequest("http://localhost/api/v1/upload?purpose=pdf", {
          method: "POST",
          body: form,
        }),
      ),
    "PDF file": () =>
      readUpload(req(`/api/v1/uploads/${ids.assetId}`), {
        params: Promise.resolve({ assetId: ids.assetId }),
      }),
    "canvas search (PDF text and transcripts)": () =>
      searchCanvas(
        req(`/api/v1/canvas-items/search?canvasId=${ids.canvasId}&q=${s.word}`),
      ),
    "video read": () =>
      readVideo(
        req(`/api/v1/canvas-items/${ids.videoId}/video`),
        item(ids.videoId),
      ),
    "video note add": () =>
      addNote(
        req(`/api/v1/canvas-items/${ids.videoId}/video/notes`, {
          method: "POST",
          body: { seconds: 9, text: "Later" },
        }),
        item(ids.videoId),
      ),
    "video note delete": () =>
      deleteNote(
        req(`/api/v1/canvas-items/${ids.videoId}/video/notes/${ids.noteId}`, {
          method: "DELETE",
        }),
        {
          params: Promise.resolve({ itemId: ids.videoId, noteId: ids.noteId }),
        },
      ),
    "transcript paste": () =>
      pasteTranscript(
        req(`/api/v1/canvas-items/${ids.videoId}/video/transcript`, {
          method: "PUT",
          body: { text: "0:01 Replaced." },
        }),
        item(ids.videoId),
      ),
    "transcript clear": () =>
      clearTranscript(
        req(`/api/v1/canvas-items/${ids.videoId}/video/transcript`, {
          method: "DELETE",
        }),
        item(ids.videoId),
      ),
    "page picture": () =>
      readPageCapture(
        req(`/api/v1/canvas-items/${ids.linkId}/page-capture/image`),
        { params: Promise.resolve({ itemId: ids.linkId, kind: "image" }) },
      ),
    "saved page": () =>
      readPageCopy(
        req(`/api/v1/canvas-items/${ids.linkId}/page-copy`),
        item(ids.linkId),
      ),
  };
}

async function trash(s: Seed) {
  as(s.owner);
  const response = await deleteCanvas(
    req(`/api/v1/canvases/${s.canvas.id}`, { method: "DELETE" }),
    { params: Promise.resolve({ canvasId: s.canvas.id }) },
  );
  expect(response.status).toBe(200);
}

describe("canvas Trash and its PDFs, videos and page captures", () => {
  it("answers like a missing canvas on every PDF, video and page-capture route", async () => {
    const s = await seed();
    const real = {
      canvasId: s.canvas.id,
      assetId: s.pdfAsset.id,
      videoId: s.video.id,
      noteId: s.note.id,
      linkId: s.link.id,
    };
    const missing = {
      canvasId: `c${suffix()}${suffix()}`,
      assetId: `c${suffix()}missing`,
      videoId: `c${suffix()}missing`,
      noteId: `c${suffix()}missing`,
      linkId: `c${suffix()}missing`,
    };

    // A "not found" text may name the id it was asked for.
    const ids = [...Object.values(real), ...Object.values(missing)];
    const withoutIds = (answer: Awaited<ReturnType<typeof problem>>) => ({
      ...answer,
      detail: ids.reduce<string | undefined>(
        (text, id) => text?.replaceAll(id, "<id>"),
        answer.detail,
      ),
    });

    // Read-only routes work before, so the checks below test the trash.
    as(s.owner);
    for (const name of [
      "PDF file",
      "canvas search (PDF text and transcripts)",
      "video read",
      "page picture",
      "saved page",
    ] as const) {
      const response = await routes(s, real)[name]();
      expect({ name, status: response.status }).toEqual({ name, status: 200 });
    }

    await trash(s);

    for (const person of [s.owner, s.collaborator]) {
      as(person);
      const onTrashed = routes(s, real);
      const onMissing = routes(s, missing);
      for (const name of Object.keys(onTrashed) as Array<
        keyof typeof onTrashed
      >) {
        const got = withoutIds(await problem(await onTrashed[name]()));
        expect({ name, status: got.status >= 400 }).toEqual({
          name,
          status: true,
        });
        expect({ name, ...got }).toEqual({
          name,
          ...withoutIds(await problem(await onMissing[name]())),
        });
      }
    }

    // Nothing was changed through them.
    await expect(
      prisma.itemVideoNote.count({ where: { itemId: s.video.id } }),
    ).resolves.toBe(1);
    await expect(
      prisma.itemTranscript.findUniqueOrThrow({
        where: { itemId: s.video.id },
      }),
    ).resolves.toMatchObject({ text: `0:05 The ${s.word} talk.` });
    await expect(
      prisma.uploadAsset.count({ where: { canvasId: s.canvas.id } }),
    ).resolves.toBe(2);
  });

  it("holds PDF, caption and page reading while in Trash, and reads after a restore", async () => {
    const s = await seed();
    vi.stubEnv("VIDEO_TRANSCRIPT_FETCH", "true");
    vi.stubEnv("PAGE_CAPTURE", "true");
    await prisma.itemTranscript.delete({ where: { itemId: s.video.id } });
    await prisma.itemPageCapture.delete({ where: { itemId: s.link.id } });
    await trash(s);

    const read = vi.fn();
    const fetchCaptions = vi.fn();
    const capture = vi.fn();
    const handlers = [
      [
        createPdfReadHandler(prisma, { read }),
        job(PDF_READ_JOB, { itemId: s.pdfCard.id }),
      ],
      [
        createVideoTranscriptHandler(prisma, { fetchCaptions }),
        job(VIDEO_TRANSCRIPT_JOB, { itemId: s.video.id }),
      ],
      [
        createPageCaptureHandler(prisma, { capture }),
        job(PAGE_CAPTURE_JOB, { itemId: s.link.id, captureId: suffix() }),
      ],
    ] as const;
    for (const [handler, queued] of handlers) {
      const before = Date.now();
      const deferred = await handler(queued).then(
        () => null,
        (error: unknown) => error,
      );
      expect(deferred).toBeInstanceOf(OutboxDeferError);
      expect((deferred as OutboxDeferError).retryAt.getTime()).toBeGreaterThan(
        before,
      );
    }
    expect(read).not.toHaveBeenCalled();
    expect(fetchCaptions).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();

    as(s.owner);
    const restored = await restoreCanvas(
      req(`/api/v1/canvases/${s.canvas.id}/restore`, { method: "POST" }),
      { params: Promise.resolve({ canvasId: s.canvas.id }) },
    );
    expect(restored.status).toBe(200);

    // The same PDF job now reads the file.
    await createPdfReadHandler(prisma)(
      job(PDF_READ_JOB, { itemId: s.pdfCard.id }),
    );
    const copy = await prisma.itemPageCopy.findUniqueOrThrow({
      where: { itemId: s.pdfCard.id },
    });
    expect(copy.text).toContain(s.word);
    vi.unstubAllEnvs();
    vi.stubEnv("UPLOAD_LOCAL_DIR", uploadDir);
    vi.stubEnv("UPLOAD_STORAGE", "local");
  });

  it("releases the PDF and page-capture files when the canvas is purged", async () => {
    const s = await seed();
    await trash(s);
    await prisma.canvas.update({
      where: { id: s.canvas.id },
      data: {
        deletedAt: new Date(
          Date.now() - (LAUNCH_LIMITS.trashRetentionDays + 1) * DAY_MS,
        ),
      },
    });

    const sweep = createTrashRetentionHandler(prisma as never);
    await sweep({ id: `sweep-${suffix()}`, type: "retention.trash" } as never);
    await sweep({ id: `sweep-${suffix()}`, type: "retention.trash" } as never);

    await expect(
      prisma.canvas.findUnique({ where: { id: s.canvas.id } }),
    ).resolves.toBeNull();
    for (const assetId of [s.pdfAsset.id, s.imageAsset.id]) {
      await expect(
        prisma.outboxJob.count({
          where: { dedupeKey: `upload.delete:${assetId}` },
        }),
      ).resolves.toBe(1);
    }
    const quota = await prisma.uploadQuota.findUniqueOrThrow({
      where: { userId: s.owner.id },
    });
    expect({
      count: quota.assetCount,
      bytes: Number(quota.totalBytes),
    }).toEqual({ count: 0, bytes: 0 });
    await expect(
      prisma.itemTranscript.count({ where: { itemId: s.video.id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.itemPageCapture.count({ where: { itemId: s.link.id } }),
    ).resolves.toBe(0);
  });
});
