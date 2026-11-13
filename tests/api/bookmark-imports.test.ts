/**
 * IMP-091: bookmark import routes check the session, cap and validate the
 * upload, and only show a person their own imports.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BookmarkImportDestination,
  BookmarkImportStatus,
} from "@/generated/prisma/client";
import { UnauthorizedError } from "@/lib/errors";
import type * as BookmarkImportModule from "@/lib/import/bookmark-import";

const auth = vi.hoisted(() => ({ requireAuth: vi.fn() }));
const db = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn() }));
const service = vi.hoisted(() => ({
  create: vi.fn(),
  summarize: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({ requireAuth: auth.requireAuth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    bookmarkImport: { findMany: db.findMany, findFirst: db.findFirst },
  },
}));
vi.mock("@/lib/import/bookmark-import", async (importActual) => ({
  ...(await importActual<typeof BookmarkImportModule>()),
  createBookmarkImport: service.create,
  summarizeBookmarkFile: service.summarize,
}));

import { GET as list, POST as start } from "@/app/api/v1/imports/route";
import { POST as preview } from "@/app/api/v1/imports/preview/route";
import { GET as status } from "@/app/api/v1/imports/[importId]/route";

const userId = "cluserxxxxxxxxxxxxxxxxxxx";
const importId = "climportxxxxxxxxxxxxxxxxx";
const CSV =
  "title,url,tags\nOne,https://a.example/1,x|y\nTwo,https://a.example/2,\n";

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: importId,
    userId,
    status: BookmarkImportStatus.QUEUED,
    destination: BookmarkImportDestination.INBOX,
    enrich: false,
    fileName: "pocket.csv",
    format: "csv",
    fileHash: "hash",
    links: [],
    total: 2,
    cursor: 0,
    imported: 0,
    duplicates: 0,
    overLimit: 0,
    invalid: 0,
    failed: 0,
    folderCanvases: {},
    lastError: "internal detail",
    startedAt: null,
    completedAt: null,
    createdAt: new Date("2026-11-12T10:00:00Z"),
    updatedAt: new Date("2026-11-12T10:00:00Z"),
    ...overrides,
  };
}

function upload(
  path: string,
  file: Blob | null,
  fields: Record<string, string> = {},
) {
  const form = new FormData();
  if (file) form.append("file", file, "pocket.csv");
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    body: form,
  });
}

beforeEach(() => {
  auth.requireAuth.mockResolvedValue({ userId, email: "owner@example.com" });
});
afterEach(() => vi.resetAllMocks());

describe("preview", () => {
  it("counts links, folders and duplicates without saving", async () => {
    service.summarize.mockResolvedValue({
      links: 2,
      folders: [],
      duplicates: 1,
      invalid: 0,
    });
    const response = await preview(
      upload("/api/v1/imports/preview", new Blob([CSV])),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      format: "csv",
      links: 2,
      duplicates: 1,
    });
    const parsed = service.summarize.mock.calls[0]![2];
    expect(parsed.links.map((link: { url: string }) => link.url)).toEqual([
      "https://a.example/1",
      "https://a.example/2",
    ]);
    expect(service.create).not.toHaveBeenCalled();
  });

  it("needs a session", async () => {
    auth.requireAuth.mockRejectedValue(new UnauthorizedError());
    const response = await preview(
      upload("/api/v1/imports/preview", new Blob([CSV])),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(401);
  });

  it("refuses a missing or binary file", async () => {
    const missing = await preview(upload("/api/v1/imports/preview", null), {
      params: Promise.resolve({}),
    });
    expect(missing.status).toBe(400);
    const binary = await preview(
      upload(
        "/api/v1/imports/preview",
        new Blob([new Uint8Array([0xff, 0xfe, 0x00, 0xc3])]),
      ),
      { params: Promise.resolve({}) },
    );
    expect(binary.status).toBe(400);
  });

  it("refuses a body over the cap before reading it", async () => {
    const request = new NextRequest("http://localhost/api/v1/imports/preview", {
      method: "POST",
      body: "x",
      headers: { "content-length": String(20 * 1024 * 1024) },
    });
    const response = await preview(request, { params: Promise.resolve({}) });
    expect(response.status).toBe(413);
  });
});

describe("start", () => {
  it("queues the import with the chosen options", async () => {
    service.create.mockResolvedValue(
      record({ destination: BookmarkImportDestination.FOLDERS, enrich: true }),
    );
    const response = await start(
      upload("/api/v1/imports", new Blob([CSV]), {
        destination: "FOLDERS",
        enrich: "true",
      }),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(202);
    expect(service.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId,
        destination: "FOLDERS",
        enrich: true,
      }),
    );
  });

  it("keeps AI off unless asked", async () => {
    service.create.mockResolvedValue(record());
    await start(upload("/api/v1/imports", new Blob([CSV])), {
      params: Promise.resolve({}),
    });
    expect(service.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ destination: "INBOX", enrich: false }),
    );
  });

  it("refuses unknown options and empty files", async () => {
    const bad = await start(
      upload("/api/v1/imports", new Blob([CSV]), { destination: "EVERYWHERE" }),
      { params: Promise.resolve({}) },
    );
    expect(bad.status).toBe(400);
    const empty = await start(
      upload("/api/v1/imports", new Blob(["url\nftp://nope/\n"])),
      { params: Promise.resolve({}) },
    );
    expect(empty.status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });
});

describe("progress", () => {
  it("lists only the person's imports", async () => {
    db.findMany.mockResolvedValue([record()]);
    const response = await list(
      new NextRequest("http://localhost/api/v1/imports"),
      {
        params: Promise.resolve({}),
      },
    );
    expect(db.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId } }),
    );
    const body = await response.json();
    expect(body.imports[0]).toMatchObject({ id: importId, processed: 0 });
    // Internal error text is only shown for failed imports.
    expect(body.imports[0].error).toBeNull();
  });

  it("does not show another person's import", async () => {
    db.findFirst.mockResolvedValue(null);
    const response = await status(
      new NextRequest(`http://localhost/api/v1/imports/${importId}`),
      { params: Promise.resolve({ importId }) },
    );
    expect(response.status).toBe(404);
    expect(db.findFirst).toHaveBeenCalledWith({
      where: { id: importId, userId },
    });
  });
});
