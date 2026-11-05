import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type * as ClipBatchModule from "@/lib/services/clip-batch";

const mocks = vi.hoisted(() => ({
  getCachedSession: vi.fn(),
  saveClipBatch: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/api/session-cache", () => ({
  getCachedSession: mocks.getCachedSession,
  runWithSessionCache: (fn: () => unknown) => fn(),
}));
vi.mock("@/lib/services/clip-batch", async (importOriginal) => {
  const actual = await importOriginal<typeof ClipBatchModule>();
  return { ...actual, saveClipBatch: mocks.saveClipBatch };
});
vi.mock("@/lib/db", () => ({
  prisma: { clipBatch: { updateMany: mocks.updateMany } },
}));

import { PATCH, POST } from "@/app/share-target/save/route";

function request(method: "POST" | "PATCH", body: unknown, json = true) {
  return new NextRequest("http://localhost/share-target/save", {
    method,
    headers: json ? { "content-type": "application/json" } : {},
    body: JSON.stringify(body),
  });
}

describe("share target save route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCachedSession.mockResolvedValue({
      user: { id: "user-1", email: "u@example.com" },
    });
  });

  it("requires a session", async () => {
    mocks.getCachedSession.mockResolvedValue(null);
    const response = await POST(
      request("POST", { shareId: "abcdefgh12", url: "https://e.example" }),
      undefined,
    );
    expect(response.status).toBe(401);
    expect(mocks.saveClipBatch).not.toHaveBeenCalled();
  });

  it("saves through the clip-batch service with a key derived from the share", async () => {
    mocks.saveClipBatch.mockResolvedValue({
      batchId: "b1",
      canvasId: "c1",
      itemIds: ["i1"],
      replayed: false,
    });
    const response = await POST(
      request("POST", {
        shareId: "abcdefgh12",
        url: "https://e.example/a",
        title: "A",
      }),
      undefined,
    );
    expect(response.status).toBe(201);
    expect(mocks.saveClipBatch).toHaveBeenCalledWith({
      userId: "user-1",
      source: "SHARE_TARGET",
      data: {
        idempotencyKey: "share-abcdefgh12",
        links: [{ url: "https://e.example/a", title: "A" }],
      },
    });
  });

  it("reports a reload as a replay", async () => {
    mocks.saveClipBatch.mockResolvedValue({
      batchId: "b1",
      canvasId: "c1",
      itemIds: ["i1"],
      replayed: true,
    });
    const response = await POST(
      request("POST", { shareId: "abcdefgh12", url: "https://e.example/a" }),
      undefined,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Idempotency-Hit")).toBe("true");
  });

  it("applies the clip-batch validation to the link", async () => {
    const response = await POST(
      request("POST", { shareId: "abcdefgh12", url: "ftp://e.example/a" }),
      undefined,
    );
    expect(response.status).toBe(400);
    expect(mocks.saveClipBatch).not.toHaveBeenCalled();
  });

  it("rejects malformed share ids and non-JSON bodies", async () => {
    expect(
      (
        await POST(
          request("POST", { shareId: "x", url: "https://e.example" }),
          undefined,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request(
            "POST",
            { shareId: "abcdefgh12", url: "https://e.example" },
            false,
          ),
          undefined,
        )
      ).status,
    ).toBe(400);
    expect(mocks.saveClipBatch).not.toHaveBeenCalled();
  });

  it("adds the sorting note to the user's own share batch", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    const response = await PATCH(
      request("PATCH", { batchId: "b1", note: "  trip ideas  " }),
      undefined,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      batchId: "b1",
      note: "trip ideas",
    });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "b1", userId: "user-1", source: "SHARE_TARGET" },
      data: { note: "trip ideas" },
    });
  });

  it("returns 404 for a batch the user does not own", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const response = await PATCH(
      request("PATCH", { batchId: "someone-else", note: "x" }),
      undefined,
    );
    expect(response.status).toBe(404);
  });

  it("rejects an over-long note", async () => {
    const response = await PATCH(
      request("PATCH", { batchId: "b1", note: "x".repeat(2001) }),
      undefined,
    );
    expect(response.status).toBe(400);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
