import { randomBytes } from "crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ItemType,
  OutboxJobStatus,
  UploadAssetStatus,
  type OutboxJob,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

// Transcription and image reading are mocked; everything else (outbox,
// storage, the note transaction, events) is real.
const ai = vi.hoisted(() => ({
  readImageText: vi.fn(),
  transcribeAudio: vi.fn(),
  generateText: vi.fn(),
}));
vi.mock("@/lib/ai/service", () => ai);

import {
  UPLOAD_NOTE_JOB,
  createUploadNoteHandler,
  requestUploadNote,
  uploadNoteDedupeKey,
} from "@/lib/uploads/upload-note";
import {
  deletePrivateUploadObject,
  writePrivateUploadObject,
} from "@/lib/uploads/private-storage";
import { pngBytes } from "../helpers/image-fixtures";

const handler = createUploadNoteHandler(prisma);
const storedKeys: string[] = [];

afterAll(async () => {
  for (const key of storedKeys) await deletePrivateUploadObject("local", key);
  await prisma.$disconnect();
});

beforeEach(() => {
  ai.readImageText.mockReset();
  ai.transcribeAudio.mockReset();
  ai.generateText.mockReset();
});

async function setup(kind: "image" | "audio") {
  const user = await prisma.user.create({
    data: {
      email: `upload-note-${randomBytes(6).toString("hex")}@example.com`,
    },
  });
  const canvas = await prisma.canvas.create({
    data: { name: "Notes", userId: user.id },
  });
  const bytes =
    kind === "image"
      ? pngBytes(40, 30)
      : Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...randomBytes(64)]);
  const mimeType = kind === "image" ? "image/png" : "audio/webm";
  const storageKey = `uploads/${user.id}/${kind}-${randomBytes(6).toString("hex")}${
    kind === "image" ? ".png" : ".webm"
  }`;
  await writePrivateUploadObject("local", storageKey, bytes, mimeType);
  storedKeys.push(storageKey);
  const asset = await prisma.uploadAsset.create({
    data: {
      userId: user.id,
      canvasId: canvas.id,
      storageKey,
      storageMode: "local",
      filename: kind === "image" ? "receipt.png" : "voice-note.webm",
      mimeType,
      size: bytes.length,
      status: UploadAssetStatus.ACTIVE,
    },
  });
  return { user, canvas, asset, bytes };
}

async function noteJob(assetId: string): Promise<OutboxJob> {
  return prisma.outboxJob.findUniqueOrThrow({
    where: { dedupeKey: uploadNoteDedupeKey(assetId) },
  });
}

async function notesOn(canvasId: string) {
  return prisma.canvasItem.findMany({
    where: { canvasId, type: ItemType.NOTE, deletedAt: null },
  });
}

describe("upload.note job against PostgreSQL", () => {
  it("reads a photo into one titled note next to it, however often it runs", async () => {
    const { user, canvas, asset, bytes } = await setup("image");
    const image = await prisma.canvasItem.create({
      data: {
        canvasId: canvas.id,
        type: ItemType.IMAGE,
        positionX: 100,
        positionY: 50,
        width: 400,
        height: 300,
        content: {
          url: `/api/v1/uploads/${asset.id}`,
          filename: "receipt.png",
        },
        createdById: user.id,
      },
    });
    ai.readImageText.mockResolvedValue(
      "**Corner shop receipt**\n\n- Milk 1.20\n- Bread 2.00\n\nTotal 3.20",
    );

    await expect(
      requestUploadNote(prisma, {
        userId: user.id,
        assetId: asset.id,
        sourceItemId: image.id,
      }),
    ).resolves.toMatchObject({ state: "pending" });
    // Asking again does not queue a second job.
    await requestUploadNote(prisma, {
      userId: user.id,
      assetId: asset.id,
      sourceItemId: image.id,
    });
    expect(
      await prisma.outboxJob.count({
        where: { dedupeKey: uploadNoteDedupeKey(asset.id) },
      }),
    ).toBe(1);

    const job = await noteJob(asset.id);
    expect(job.type).toBe(UPLOAD_NOTE_JOB);
    // A crashed-and-retried job and a concurrent duplicate both run.
    await Promise.all([handler(job), handler(job)]);
    await handler(job);

    const notes = await notesOn(canvas.id);
    expect(notes).toHaveLength(1);
    const note = notes[0]!;
    expect(note.positionX).toBe(100 + 400 + 24);
    expect(note.positionY).toBe(50);
    expect(note.createdById).toBe(user.id);
    expect(note.tags).toEqual(["ai-generated", "photo-note"]);
    const content = note.content as {
      plainText: string;
      text: string;
      document: { content: Array<{ type: string }> };
    };
    expect(content.document.content[0]).toMatchObject({
      type: "heading",
      content: [{ type: "text", text: "Corner shop receipt" }],
    });
    expect(content.document.content[1]?.type).toBe("bulletList");
    expect(content.plainText).toContain("Milk 1.20");
    expect(content.text).toContain(`href="/api/v1/uploads/${asset.id}"`);

    // The image was sent as stored; the original is kept and points at the note.
    // Two concurrent runs may each read the image, but the later run skipped
    // before calling the provider at all.
    expect(ai.readImageText).toHaveBeenCalledTimes(2);
    const call = ai.readImageText.mock.calls[0]![0];
    expect(call.userId).toBe(user.id);
    expect(call.mimeType).toBe("image/png");
    expect(Buffer.from(call.image).equals(bytes)).toBe(true);
    const kept = await prisma.uploadAsset.findUniqueOrThrow({
      where: { id: asset.id },
    });
    expect(kept.status).toBe(UploadAssetStatus.ACTIVE);
    expect(kept.noteItemId).toBe(note.id);
    expect(
      await prisma.canvasItem.count({
        where: { id: image.id, deletedAt: null },
      }),
    ).toBe(1);
    expect(
      await prisma.canvasEvent.count({
        where: { canvasId: canvas.id, entityId: note.id, operation: "created" },
      }),
    ).toBe(1);

    // Requesting again returns the live note instead of making another.
    await expect(
      requestUploadNote(prisma, { userId: user.id, assetId: asset.id }),
    ).resolves.toEqual({ state: "done", noteItemId: note.id, error: null });

    // Once the note is deleted, a new request re-arms the same job.
    await prisma.outboxJob.update({
      where: { id: job.id },
      data: { status: OutboxJobStatus.COMPLETED, completedAt: new Date() },
    });
    await prisma.canvasItem.update({
      where: { id: note.id },
      data: { deletedAt: new Date() },
    });
    await expect(
      requestUploadNote(prisma, { userId: user.id, assetId: asset.id }),
    ).resolves.toMatchObject({ state: "pending" });
    const rearmed = await noteJob(asset.id);
    expect(rearmed.id).toBe(job.id);
    expect(rearmed.status).toBe(OutboxJobStatus.PENDING);
    await handler(rearmed);
    const again = await notesOn(canvas.id);
    expect(again).toHaveLength(1);
    expect(again[0]!.id).not.toBe(note.id);
  });

  it("transcribes a voice note, tidies it and places it where it was recorded", async () => {
    const { user, canvas, asset } = await setup("audio");
    ai.transcribeAudio.mockResolvedValue(
      "um so remember to uh call the plumber on friday",
    );
    ai.generateText.mockResolvedValue(
      "Call the plumber\n\nRemember to call the plumber on Friday.",
    );
    await requestUploadNote(prisma, {
      userId: user.id,
      assetId: asset.id,
      positionX: 640,
      positionY: -80,
    });
    const job = await noteJob(asset.id);
    await handler(job);
    await handler(job);

    const notes = await notesOn(canvas.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ positionX: 640, positionY: -80 });
    expect(notes[0]!.tags).toEqual(["ai-generated", "voice-note"]);
    const content = notes[0]!.content as { plainText: string; text: string };
    expect(content.plainText).toContain("Call the plumber");
    expect(content.plainText).toContain("on Friday.");
    expect(content.text).toContain(`href="/api/v1/uploads/${asset.id}"`);
    expect(ai.transcribeAudio).toHaveBeenCalledTimes(1);
    expect(ai.transcribeAudio.mock.calls[0]![0]).toMatchObject({
      mimeType: "audio/webm",
      filename: "voice-note.webm",
    });
    expect(ai.generateText.mock.calls[0]![0].prompt).toContain(
      "call the plumber on friday",
    );
  });

  it("does nothing for an upload that was deleted, and refuses a requester without edit access", async () => {
    const { user, canvas, asset } = await setup("image");
    await requestUploadNote(prisma, { userId: user.id, assetId: asset.id });
    const job = await noteJob(asset.id);

    const stranger = await prisma.user.create({
      data: { email: `stranger-${randomBytes(6).toString("hex")}@example.com` },
    });
    await expect(
      handler({
        ...job,
        payload: { assetId: asset.id, requestedById: stranger.id },
      }),
    ).rejects.toMatchObject({ retryable: false });

    await prisma.uploadAsset.update({
      where: { id: asset.id },
      data: { status: UploadAssetStatus.DELETING },
    });
    await handler(job);
    expect(await notesOn(canvas.id)).toHaveLength(0);
    expect(ai.readImageText).not.toHaveBeenCalled();
  });
});
