import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getCachedSession: vi.fn(),
  requireItemAccess: vi.fn(),
  findItem: vi.fn(),
  findUser: vi.fn(),
  updateUser: vi.fn(),
  createJobs: vi.fn(),
  aiAvailability: vi.fn(async () => ({ configured: false })),
}));

vi.mock("@/lib/api/session-cache", () => ({
  getCachedSession: mocks.getCachedSession,
  runWithSessionCache: (fn: () => unknown) => fn(),
}));
vi.mock("@/lib/api/auth", () => ({
  requireItemAccess: mocks.requireItemAccess,
}));
vi.mock("@/lib/ai/provider-resolution", () => ({
  getAiAvailability: mocks.aiAvailability,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    canvasItem: { findFirst: mocks.findItem },
    user: { findUnique: mocks.findUser, update: mocks.updateUser },
    outboxJob: { createMany: mocks.createJobs },
  },
}));

import { GET } from "@/app/api/v1/canvas-items/[itemId]/page-copy/route";
import {
  GET as getLinkSettings,
  PATCH as patchLinkSettings,
} from "@/app/api/v1/ai/link-enrichment/route";

const URL_ = "https://news.example/story";

function read(itemId = "item-1") {
  return GET(
    new NextRequest(`http://localhost/api/v1/canvas-items/${itemId}/page-copy`),
    { params: Promise.resolve({ itemId }) },
  );
}

function bookmark(pageCopy: Record<string, unknown> | null) {
  return { type: "BOOKMARK", content: { url: URL_ }, pageCopy };
}

const copy = {
  url: URL_,
  text: "<script>alert(1)</script> The story.",
  readAt: new Date("2026-11-01T10:00:00Z"),
  archiveUrl: null,
  archiveCheckedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mocks.getCachedSession.mockResolvedValue({
    user: { id: "u1", email: "u1@example.com" },
  });
  mocks.requireItemAccess.mockResolvedValue("VIEW");
  mocks.findUser.mockResolvedValue({
    autoEnrichLinks: true,
    webArchiveLookup: true,
  });
});

describe("GET /api/v1/canvas-items/{itemId}/page-copy (IMP-094)", () => {
  it("checks that the person may view the canvas", async () => {
    const { ForbiddenError } = await import("@/lib/errors");
    mocks.requireItemAccess.mockRejectedValue(new ForbiddenError("No"));
    const response = await read();
    expect(response.status).toBe(403);
    expect(mocks.findItem).not.toHaveBeenCalled();
    expect(mocks.requireItemAccess).toHaveBeenCalledWith(
      "item-1",
      "u1",
      "u1@example.com",
      "VIEW",
    );
  });

  it("returns the saved text as plain data with when it was read", async () => {
    mocks.findItem.mockResolvedValue(bookmark(copy));
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      url: URL_,
      copy: {
        text: copy.text,
        readAt: "2026-11-01T10:00:00.000Z",
        archiveUrl: null,
      },
      archivePending: false,
    });
  });

  it("does not offer a copy of an address the link no longer points to", async () => {
    mocks.findItem.mockResolvedValue(
      bookmark({ ...copy, url: "https://old.example/" }),
    );
    expect((await (await read()).json()).copy).toBeNull();
  });

  it("is 404 for anything but a live saved link", async () => {
    mocks.findItem.mockResolvedValue(null);
    expect((await read()).status).toBe(404);
    mocks.findItem.mockResolvedValue({
      type: "NOTE",
      content: {},
      pageCopy: null,
    });
    expect((await read()).status).toBe(404);
  });

  it("starts a web-archive lookup only for the owner who turned it on", async () => {
    vi.stubEnv("WEB_ARCHIVE_LOOKUP", "true");
    mocks.findItem.mockResolvedValue(bookmark(copy));
    expect((await (await read()).json()).archivePending).toBe(false);
    expect(mocks.createJobs).not.toHaveBeenCalled();

    mocks.requireItemAccess.mockResolvedValue("OWNER");
    expect((await (await read()).json()).archivePending).toBe(true);
    expect(mocks.createJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            type: "link.page-copy",
            dedupeKey: "link.page-copy:item-1:archive",
          }),
        ],
      }),
    );

    mocks.createJobs.mockClear();
    mocks.findItem.mockResolvedValue(
      bookmark({ ...copy, archiveCheckedAt: new Date() }),
    );
    expect((await (await read()).json()).archivePending).toBe(false);
    expect(mocks.createJobs).not.toHaveBeenCalled();
  });
});

describe("link settings: web-archive lookup (IMP-094)", () => {
  function patch(body: unknown) {
    return patchLinkSettings(
      new NextRequest("http://localhost/api/v1/ai/link-enrichment", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      {},
    );
  }

  it("is hidden and refused unless the deployment allows it", async () => {
    const response = await getLinkSettings(
      new NextRequest("http://localhost/api/v1/ai/link-enrichment"),
      {},
    );
    expect(await response.json()).toMatchObject({
      webArchiveAvailable: false,
      webArchiveLookup: false,
    });
    expect((await patch({ webArchiveLookup: true })).status).toBe(400);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("saves the person's choice when allowed, leaving the other setting alone", async () => {
    vi.stubEnv("WEB_ARCHIVE_LOOKUP", "true");
    const response = await patch({ webArchiveLookup: true });
    expect(response.status).toBe(200);
    expect(mocks.updateUser).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { webArchiveLookup: true },
    });
    expect((await patch({})).status).toBe(400);
  });
});

describe("link settings: your own tagging rules (IMP-106)", () => {
  function patch(body: unknown) {
    return patchLinkSettings(
      new NextRequest("http://localhost/api/v1/ai/link-enrichment", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      {},
    );
  }

  it("saves the rules trimmed, and an empty box returns to the standard", async () => {
    expect((await patch({ taggingRules: "  Use few tags.  " })).status).toBe(
      200,
    );
    expect(mocks.updateUser).toHaveBeenLastCalledWith({
      where: { id: "u1" },
      data: { taggingRules: "Use few tags." },
    });
    expect((await patch({ taggingRules: "" })).status).toBe(200);
    expect(mocks.updateUser).toHaveBeenLastCalledWith({
      where: { id: "u1" },
      data: { taggingRules: null },
    });
  });

  it("refuses rules over the limit and shows the saved ones", async () => {
    expect((await patch({ taggingRules: "x".repeat(1001) })).status).toBe(400);
    expect(mocks.updateUser).not.toHaveBeenCalled();
    mocks.findUser.mockResolvedValue({
      autoEnrichLinks: true,
      webArchiveLookup: false,
      taggingRules: "Use few tags.",
    });
    const response = await getLinkSettings(
      new NextRequest("http://localhost/api/v1/ai/link-enrichment"),
      {},
    );
    expect(await response.json()).toMatchObject({
      taggingRules: "Use few tags.",
    });
  });
});
