/**
 * IMP-091: a bookmark import runs in chunks, resumes after a crash without
 * saving anything twice, skips links already saved, puts folders on their
 * own canvases, and counts what does not fit.
 */
import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import type * as Limits from "@/lib/policy/launch-limits";

vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));
vi.mock("@/lib/policy/launch-limits", async (importOriginal) => {
  const actual = await importOriginal<typeof Limits>();
  return {
    ...actual,
    LAUNCH_LIMITS: { ...actual.LAUNCH_LIMITS, itemsPerCanvas: 150 },
  };
});

import {
  BookmarkImportDestination,
  BookmarkImportStatus,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  BOOKMARK_IMPORT_JOB,
  createBookmarkImport,
  createBookmarkImportHandler,
  importNextChunk,
  summarizeBookmarkFile,
} from "@/lib/import/bookmark-import";
import type {
  ImportedLink,
  ParsedBookmarkFile,
} from "@/lib/import/bookmark-file";

afterAll(async () => {
  await prisma.$disconnect();
});

async function createUser() {
  return prisma.user.create({
    data: {
      email: `import-${randomBytes(6).toString("hex")}@example.com`,
      autoEnrichLinks: true,
    },
  });
}

function file(links: ImportedLink[]): ParsedBookmarkFile {
  const folders = [
    ...new Set(links.flatMap((link) => (link.folder ? [link.folder] : []))),
  ];
  return { format: "html", links, folders, invalid: 0 };
}

function link(n: number, folder: string | null = null): ImportedLink {
  return {
    url: `https://site.example/page/${n}`,
    title: `Page ${n}`,
    tags: folder ? [folder, "imported"] : ["imported"],
    folder,
    addedAt: null,
  };
}

async function run(importId: string) {
  while (!(await importNextChunk(prisma, importId))) {
    // keep going
  }
  return prisma.bookmarkImport.findUniqueOrThrow({ where: { id: importId } });
}

describe("bookmark import", () => {
  it("imports into the Inbox in chunks; the same file again adds nothing", async () => {
    const user = await createUser();
    const links = Array.from({ length: 120 }, (_, n) => link(n));
    links.push(link(3)); // a repeat inside the file
    const parsed = file(links);
    const first = await createBookmarkImport(prisma, {
      userId: user.id,
      fileName: "bookmarks.html",
      parsed,
      destination: BookmarkImportDestination.INBOX,
      enrich: false,
    });
    expect(
      await prisma.outboxJob.count({
        where: { dedupeKey: `${BOOKMARK_IMPORT_JOB}:${first.id}` },
      }),
    ).toBe(1);

    const done = await run(first.id);
    expect(done).toMatchObject({
      status: BookmarkImportStatus.COMPLETED,
      cursor: 121,
      imported: 120,
      duplicates: 1,
      overLimit: 0,
    });
    const items = await prisma.canvasItem.findMany({
      where: { canvas: { userId: user.id, name: "Inbox" }, deletedAt: null },
      select: { tags: true, positionX: true, positionY: true },
    });
    expect(items).toHaveLength(120);
    expect(items[0]!.tags).toEqual(["imported"]);
    // No two links share a spot.
    expect(
      new Set(items.map((item) => `${item.positionX},${item.positionY}`)).size,
    ).toBe(120);
    // AI was not asked for, so no enrichment jobs, even with the setting on.
    expect(
      await prisma.itemEnrichment.count({ where: { userId: user.id } }),
    ).toBe(0);

    expect(await summarizeBookmarkFile(prisma, user.id, parsed)).toMatchObject({
      links: 121,
      duplicates: 121,
    });
    const again = await createBookmarkImport(prisma, {
      userId: user.id,
      fileName: "bookmarks.html",
      parsed,
      destination: BookmarkImportDestination.INBOX,
      enrich: false,
    });
    expect(await run(again.id)).toMatchObject({
      imported: 0,
      duplicates: 121,
    });
  });

  it("resumes after a crash without saving a chunk twice", async () => {
    const user = await createUser();
    const record = await createBookmarkImport(prisma, {
      userId: user.id,
      fileName: "pocket.csv",
      parsed: file(Array.from({ length: 130 }, (_, n) => link(1000 + n))),
      destination: BookmarkImportDestination.INBOX,
      enrich: true,
    });
    // First run commits one chunk, then the worker dies.
    expect(await importNextChunk(prisma, record.id)).toBe(false);
    const job = await prisma.outboxJob.findFirstOrThrow({
      where: { dedupeKey: `${BOOKMARK_IMPORT_JOB}:${record.id}` },
    });
    // A second worker runs the whole job.
    await createBookmarkImportHandler(prisma)({ ...job, attempts: 1 });
    const done = await prisma.bookmarkImport.findUniqueOrThrow({
      where: { id: record.id },
    });
    expect(done).toMatchObject({
      status: BookmarkImportStatus.COMPLETED,
      imported: 130,
    });
    expect(
      await prisma.canvasItem.count({
        where: { canvas: { userId: user.id }, deletedAt: null },
      }),
    ).toBe(130);
    // AI naming was turned on for this import.
    expect(
      await prisma.itemEnrichment.count({ where: { userId: user.id } }),
    ).toBe(130);
    // Running it once more changes nothing.
    await createBookmarkImportHandler(prisma)({ ...job, attempts: 2 });
    expect(
      await prisma.canvasItem.count({
        where: { canvas: { userId: user.id }, deletedAt: null },
      }),
    ).toBe(130);
  });

  it("puts each top-level folder on its own canvas and counts what does not fit", async () => {
    const user = await createUser();
    const existing = await prisma.canvas.create({
      data: { userId: user.id, name: "Recipes" },
    });
    const links = [
      ...Array.from({ length: 160 }, (_, n) => link(2000 + n, "Travel")),
      ...Array.from({ length: 5 }, (_, n) => link(3000 + n, "Recipes")),
      link(4000),
    ];
    const record = await createBookmarkImport(prisma, {
      userId: user.id,
      fileName: "bookmarks.html",
      parsed: file(links),
      destination: BookmarkImportDestination.FOLDERS,
      enrich: false,
    });
    const done = await run(record.id);
    expect(done).toMatchObject({
      imported: 156,
      overLimit: 10,
      duplicates: 0,
    });
    const canvases = await prisma.canvas.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, _count: { select: { items: true } } },
      orderBy: { name: "asc" },
    });
    expect(
      canvases.map((canvas) => [canvas.name, canvas._count.items]),
    ).toEqual([
      ["Inbox", 1],
      ["Recipes", 5],
      ["Travel", 150],
    ]);
    // An existing canvas with the folder's name is reused.
    expect(canvases.find((c) => c.name === "Recipes")!.id).toBe(existing.id);
    const travel = await prisma.canvasItem.findFirstOrThrow({
      where: { canvas: { userId: user.id, name: "Travel" } },
      select: { tags: true },
    });
    expect(travel.tags).toEqual(["Travel", "imported"]);
  });
});
