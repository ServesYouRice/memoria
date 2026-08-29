import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireAuth: vi.fn() }));
const db = vi.hoisted(() => ({
  canvasFindUnique: vi.fn(),
  queryRaw: vi.fn(),
  candidateUpsert: vi.fn(),
  transaction: vi.fn(),
}));
const outbox = vi.hoisted(() => ({ enqueue: vi.fn() }));

vi.mock("@/lib/api/auth", () => ({ requireAuth: auth.requireAuth }));
vi.mock("@/lib/outbox/enqueue", () => ({
  enqueueOutboxJob: outbox.enqueue,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    canvas: { findUnique: db.canvasFindUnique },
    $transaction: db.transaction,
  },
}));

import { POST } from "@/app/api/v1/canvases/[canvasId]/thumbnail/route";

const canvasId = "clcanvasxxxxxxxxxxxxxxxxx";
const candidateId = "clcandidatexxxxxxxxxxxxxxx";
const context = { params: Promise.resolve({ canvasId }) };

function request(expectedRevision: string) {
  return new Request(`http://localhost/api/v1/canvases/${canvasId}/thumbnail`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      thumbnail: "data:image/png;base64,cG5n",
      expectedRevision,
    }),
  }) as never;
}

describe("stable thumbnail revision admission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireAuth.mockResolvedValue({ userId: "user-1" });
    db.canvasFindUnique.mockResolvedValue({ userId: "user-1" });
    db.queryRaw.mockResolvedValue([{ revision: 5n }]);
    db.candidateUpsert.mockResolvedValue({ id: candidateId });
    db.transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) =>
        callback({
          $queryRaw: db.queryRaw,
          canvas: { findUnique: db.canvasFindUnique },
          canvasThumbnailCandidate: { upsert: db.candidateUpsert },
        }),
    );
  });

  it("drops an idle capture when a newer durable event already exists", async () => {
    const response = await POST(request("4"), context);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      queued: false,
      stale: true,
      revision: "5",
    });
    expect(db.candidateUpsert).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it("queues exactly the candidate matching the current durable revision", async () => {
    db.canvasFindUnique
      .mockResolvedValueOnce({ userId: "user-1" })
      .mockResolvedValueOnce({ thumbnailRevision: 4n, thumbnailKey: null });
    const response = await POST(request("5"), context);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      queued: true,
      stale: false,
      revision: "5",
    });
    expect(db.candidateUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { canvasId_revision: { canvasId, revision: 5n } },
      }),
    );
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        dedupeKey: `thumbnail.store:${canvasId}:5`,
      }),
    );
  });
});
