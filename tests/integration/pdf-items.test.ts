/**
 * IMP-113: a PDF card on PostgreSQL. Creating one queues its text reading;
 * the job keeps the text in the saved-text store, search and Ask find words
 * found only inside the file, and purging the card from the trash removes
 * its text and queues its file's deletion.
 */
import { randomBytes } from "crypto";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authState = vi.hoisted(() => ({ userId: "", email: "" }));
vi.mock("@/lib/api/auth", () => ({
  requireAuth: async () => ({ ...authState }),
  requireCanvasAccess: async () => "OWNER",
}));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: authState.userId, email: authState.email },
  })),
}));
vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));

import { prisma } from "@/lib/db";
import { POST as createItem } from "@/app/api/v1/canvas-items/route";
import { GET as search } from "@/app/api/v1/search/route";
import { searchOwnedItems } from "@/lib/ai/ask";
import { createPdfReadHandler } from "@/lib/pdf/outbox-handler";
import { pdfReadDedupeKey } from "@/lib/pdf/pdf-items";
import { createTrashRetentionHandler } from "@/lib/retention/outbox-handler";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";
import type { OutboxJob } from "@/generated/prisma/client";
import { pdfBytes } from "../helpers/pdf-fixtures";

let uploadDir: string;
const previousUploadDir = process.env.UPLOAD_LOCAL_DIR;

beforeAll(async () => {
  uploadDir = await mkdtemp(join(tmpdir(), "memoria-pdf-"));
  process.env.UPLOAD_LOCAL_DIR = uploadDir;
});

afterAll(async () => {
  if (previousUploadDir === undefined) delete process.env.UPLOAD_LOCAL_DIR;
  else process.env.UPLOAD_LOCAL_DIR = previousUploadDir;
  await rm(uploadDir, { recursive: true, force: true });
  await prisma.$disconnect();
});

function job(type: string, payload: Record<string, unknown>): OutboxJob {
  return {
    id: `job-${randomBytes(4).toString("hex")}`,
    type,
    payload,
    attempts: 1,
    maxAttempts: 4,
  } as OutboxJob;
}

async function fixture(pages: string[]) {
  const tag = randomBytes(6).toString("hex");
  const user = await prisma.user.create({
    data: { email: `pdf-${tag}@example.com` },
  });
  authState.userId = user.id;
  authState.email = user.email;
  const canvas = await prisma.canvas.create({
    data: { name: "Papers", userId: user.id },
  });
  const bytes = pdfBytes(pages);
  const storageKey = `uploads/${user.id}/report-${tag}.pdf`;
  await mkdir(join(uploadDir, user.id), { recursive: true });
  await writeFile(join(uploadDir, user.id, `report-${tag}.pdf`), bytes);
  const asset = await prisma.uploadAsset.create({
    data: {
      userId: user.id,
      canvasId: canvas.id,
      storageKey,
      storageMode: "local",
      filename: "report.pdf",
      mimeType: "application/pdf",
      size: bytes.length,
      status: "ACTIVE",
    },
  });
  await prisma.uploadQuota.create({
    data: { userId: user.id, assetCount: 1, totalBytes: BigInt(bytes.length) },
  });
  return { tag, user, canvas, asset, size: bytes.length };
}

async function addPdfCard(canvasId: string, assetId: string, size: number) {
  const response = await createItem(
    new NextRequest("http://localhost/api/v1/canvas-items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        canvasId,
        type: "PDF",
        positionX: 0,
        positionY: 0,
        width: 260,
        height: 132,
        content: { assetId, filename: "report.pdf", size },
      }),
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; version: number };
}

describe("PDF cards (IMP-113)", () => {
  it("reads the file once, and search and Ask find words only inside it", async () => {
    const word = `wombat${randomBytes(6).toString("hex")}`;
    const { user, canvas, asset, size } = await fixture([
      "Cover page",
      `The ${word} clause is on page two`,
    ]);
    const card = await addPdfCard(canvas.id, asset.id, size);

    const queued = await prisma.outboxJob.findUniqueOrThrow({
      where: { dedupeKey: pdfReadDedupeKey(card.id) },
    });
    expect(queued).toMatchObject({ type: "pdf.read", status: "PENDING" });

    const handler = createPdfReadHandler(prisma);
    await handler(job("pdf.read", { itemId: card.id }));
    const read = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: card.id },
    });
    expect(read.content).toMatchObject({ pageCount: 2, textStatus: "ready" });
    expect(read.version).toBe(card.version + 1);
    const copy = await prisma.itemPageCopy.findUniqueOrThrow({
      where: { itemId: card.id },
    });
    expect(copy.url).toBe(`/api/v1/uploads/${asset.id}`);
    expect(copy.userId).toBe(user.id);
    expect(copy.text).toContain(word);

    // Safe to run twice: nothing changes.
    await handler(job("pdf.read", { itemId: card.id }));
    await expect(
      prisma.canvasItem.findUniqueOrThrow({ where: { id: card.id } }),
    ).resolves.toMatchObject({ version: read.version });

    const response = await search(
      new Request(`http://localhost/api/v1/search?q=${word}`),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.totalResults).toBe(1);
    expect(body.results[0]).toMatchObject({
      itemId: card.id,
      itemType: "PDF",
    });
    expect(body.results[0].snippet).toContain(`report.pdf`);
    expect(body.results[0].snippet).toContain(`The ${word} clause`);

    const asked = await searchOwnedItems(user.id, [word]);
    expect(asked.map((row) => row.id)).toEqual([card.id]);
  });

  it("says a PDF has no readable text, and keeps the file", async () => {
    const { canvas, asset, size } = await fixture(["", ""]);
    const card = await addPdfCard(canvas.id, asset.id, size);
    await createPdfReadHandler(prisma)(job("pdf.read", { itemId: card.id }));
    await expect(
      prisma.canvasItem.findUniqueOrThrow({ where: { id: card.id } }),
    ).resolves.toMatchObject({
      content: { pageCount: 2, textStatus: "no-text" },
    });
    await expect(
      prisma.itemPageCopy.findUnique({ where: { itemId: card.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.uploadAsset.findUniqueOrThrow({ where: { id: asset.id } }),
    ).resolves.toMatchObject({ status: "ACTIVE" });
  });

  it("never reads another canvas's file into a card", async () => {
    const theirs = await fixture([`secret${randomBytes(4).toString("hex")}`]);
    const mine = await fixture(["mine"]);
    const card = await addPdfCard(mine.canvas.id, theirs.asset.id, 10);
    await createPdfReadHandler(prisma)(job("pdf.read", { itemId: card.id }));
    await expect(
      prisma.canvasItem.findUniqueOrThrow({ where: { id: card.id } }),
    ).resolves.toMatchObject({ content: { textStatus: "unreadable" } });
    await expect(
      prisma.itemPageCopy.findUnique({ where: { itemId: card.id } }),
    ).resolves.toBeNull();
  });

  it("deletes the text and queues the file's deletion when the card is purged", async () => {
    const { user, canvas, asset, size } = await fixture(["Purge me"]);
    const card = await addPdfCard(canvas.id, asset.id, size);
    await createPdfReadHandler(prisma)(job("pdf.read", { itemId: card.id }));
    await expect(
      prisma.itemPageCopy.findUnique({ where: { itemId: card.id } }),
    ).resolves.not.toBeNull();

    // A card in the trash keeps its file and text until it expires.
    const expired = new Date(
      Date.now() - (LAUNCH_LIMITS.trashRetentionDays + 1) * 86_400_000,
    );
    await prisma.canvasItem.update({
      where: { id: card.id },
      data: { deletedAt: expired },
    });
    await createTrashRetentionHandler(prisma)(job("retention.trash", {}));

    await expect(
      prisma.canvasItem.findUnique({ where: { id: card.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.itemPageCopy.findUnique({ where: { itemId: card.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.uploadAsset.findUniqueOrThrow({ where: { id: asset.id } }),
    ).resolves.toMatchObject({ status: "DELETING" });
    await expect(
      prisma.outboxJob.findUnique({
        where: { dedupeKey: `upload.delete:${asset.id}` },
      }),
    ).resolves.toMatchObject({ type: "upload.delete" });
    await expect(
      prisma.uploadQuota.findUniqueOrThrow({ where: { userId: user.id } }),
    ).resolves.toMatchObject({ assetCount: 0, totalBytes: BigInt(0) });
  });

  it("keeps a file another card still names when one card is purged", async () => {
    const { canvas, asset, size } = await fixture(["Shared"]);
    const first = await addPdfCard(canvas.id, asset.id, size);
    await addPdfCard(canvas.id, asset.id, size);
    await prisma.canvasItem.update({
      where: { id: first.id },
      data: {
        deletedAt: new Date(
          Date.now() - (LAUNCH_LIMITS.trashRetentionDays + 1) * 86_400_000,
        ),
      },
    });
    await createTrashRetentionHandler(prisma)(job("retention.trash", {}));
    await expect(
      prisma.canvasItem.findUnique({ where: { id: first.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.uploadAsset.findUniqueOrThrow({ where: { id: asset.id } }),
    ).resolves.toMatchObject({ status: "ACTIVE" });
  });
});
