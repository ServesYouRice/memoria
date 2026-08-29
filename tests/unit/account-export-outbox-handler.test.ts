import { gunzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccountExportStatus,
  UploadAssetStatus,
  type PrismaClient,
} from "@/generated/prisma/client";

const storage = vi.hoisted(() => ({
  written: Buffer.alloc(0),
  write: vi.fn(),
  read: vi.fn(),
  remove: vi.fn(),
}));
const outbox = vi.hoisted(() => ({ enqueue: vi.fn() }));

vi.mock("@/lib/uploads/private-storage", () => ({
  writePrivateUploadStream: storage.write,
  readPrivateUploadObject: storage.read,
  deletePrivateUploadObject: storage.remove,
}));
vi.mock("@/lib/outbox/enqueue", () => ({
  enqueueOutboxJob: outbox.enqueue,
}));

import { createAccountExportBuildHandler } from "@/lib/account-export/outbox-handler";

const exportId = "clexportxxxxxxxxxxxxxxxxx";
const userId = "cluserxxxxxxxxxxxxxxxxxxx";

function fakePrisma(
  options: {
    cancelDuringBuild?: boolean;
    withUpload?: boolean;
    initialStatus?: AccountExportStatus;
    startedAt?: Date | null;
  } = {},
) {
  let status = options.initialStatus ?? AccountExportStatus.QUEUED;
  let checks = 0;
  const exportRecord = {
    id: exportId,
    userId,
    status,
    formatVersion: 2,
    storageMode: "local",
    storageKey: null,
    byteSize: null,
    sha256: null,
    manifest: null,
    lastError: null,
    cancelRequestedAt: null,
    startedAt: options.startedAt ?? null,
    completedAt: null,
    expiresAt: new Date("2026-08-30T12:00:00.000Z"),
    createdAt: new Date("2026-08-29T12:00:00.000Z"),
    updatedAt: new Date("2026-08-29T12:00:00.000Z"),
  };
  const accountExport = {
    findUnique: vi.fn(async (query: { select?: unknown }) => {
      if (query.select) {
        checks += 1;
        return {
          status:
            options.cancelDuringBuild && checks >= 2
              ? AccountExportStatus.CANCELLED
              : status,
          cancelRequestedAt:
            options.cancelDuringBuild && checks >= 2 ? new Date() : null,
        };
      }
      return { ...exportRecord, status };
    }),
    update: vi.fn(async (query: { data: { status?: AccountExportStatus } }) => {
      status = query.data.status || status;
      return { ...exportRecord, status };
    }),
    updateMany: vi.fn(
      async (query: { data: { status?: AccountExportStatus } }) => {
        status = query.data.status || status;
        return { count: 1 };
      },
    ),
  };
  const emptyPage = vi.fn().mockResolvedValue([]);
  const client = {
    accountExport,
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: userId,
        email: "owner@example.com",
        emailVerified: new Date("2026-01-01T00:00:00.000Z"),
        name: "Owner",
        image: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    },
    workspace: { findMany: emptyPage },
    canvas: { findMany: emptyPage },
    canvasItem: { findMany: emptyPage },
    canvasVersion: { findMany: emptyPage },
    canvasShare: { findMany: emptyPage },
    comment: { findMany: emptyPage },
    activity: { findMany: emptyPage },
    notificationPreference: { findMany: emptyPage },
    uploadAsset: {
      findMany: vi.fn().mockResolvedValue(
        options.withUpload
          ? [
              {
                id: "asset-1",
                canvasId: "canvas-1",
                storageKey: "uploads/user/asset-1",
                storageMode: "local",
                filename: "note.txt",
                mimeType: "text/plain",
                size: 5,
                status: UploadAssetStatus.ACTIVE,
                createdAt: new Date("2026-08-29T12:00:00.000Z"),
              },
            ]
          : [],
      ),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback(client),
    ),
  };
  return { client: client as unknown as PrismaClient, accountExport };
}

function job() {
  return {
    id: "cljobxxxxxxxxxxxxxxxxxxxx",
    payload: { exportId },
    attempts: 1,
    maxAttempts: 3,
  } as never;
}

describe("account export outbox handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.written = Buffer.alloc(0);
    storage.write.mockImplementation(
      async (_mode: string, _key: string, body: AsyncIterable<Uint8Array>) => {
        const chunks: Buffer[] = [];
        for await (const chunk of body) chunks.push(Buffer.from(chunk));
        storage.written = Buffer.concat(chunks);
      },
    );
    storage.read.mockResolvedValue({
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("hello"));
          controller.close();
        },
      }),
      contentLength: 5,
      contentType: "text/plain",
      etag: 'W/"upload"',
    });
  });

  it("writes a versioned, checksummed archive and includes authorized upload bytes", async () => {
    const { client, accountExport } = fakePrisma({ withUpload: true });

    await createAccountExportBuildHandler(client)(job());

    expect(storage.write).toHaveBeenCalledWith(
      "local",
      `account-exports/${userId}/${exportId}/cljobxxxxxxxxxxxxxxxxxxxx-1.jsonl.gz`,
      expect.anything(),
      "application/gzip",
      expect.any(Number),
      undefined,
    );
    const lines = gunzipSync(storage.written)
      .toString("utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { recordType: string; value: any });
    expect(lines[0]).toMatchObject({
      recordType: "manifest",
      value: { formatVersion: 2 },
    });
    expect(lines.some((line) => line.recordType === "profile")).toBe(true);
    const uploadChunk = lines.find(
      (line) => line.recordType === "uploadObjectChunk",
    );
    expect(Buffer.from(uploadChunk!.value.data, "base64").toString()).toBe(
      "hello",
    );
    expect(lines.at(-1)?.recordType).toBe("manifestEnd");

    const completion = accountExport.updateMany.mock.calls.find(
      ([query]) => query.data.status === AccountExportStatus.COMPLETED,
    );
    expect(completion?.[0].data).toMatchObject({
      byteSize: BigInt(storage.written.length),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      manifest: expect.objectContaining({ formatVersion: 2 }),
    });
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "account-export.delete" }),
    );
  });

  it("does not restart a fresh running delivery", async () => {
    const { client, accountExport } = fakePrisma({
      initialStatus: AccountExportStatus.RUNNING,
      startedAt: new Date(),
    });

    await createAccountExportBuildHandler(client)(job());

    expect(accountExport.updateMany).not.toHaveBeenCalled();
    expect(storage.write).not.toHaveBeenCalled();
  });

  it("stops between bounded pages when cancellation is requested", async () => {
    const { client, accountExport } = fakePrisma({ cancelDuringBuild: true });

    await createAccountExportBuildHandler(client)(job());

    expect(storage.write).not.toHaveBeenCalled();
    expect(accountExport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: AccountExportStatus.CANCELLED,
        }),
      }),
    );
  });
});
