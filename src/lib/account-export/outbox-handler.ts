import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { z } from "zod";
import {
  AccountExportStatus,
  UploadAssetStatus,
  type Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import type { OutboxHandler } from "@/lib/outbox/types";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";
import {
  deletePrivateUploadObject,
  readPrivateUploadObject,
  writePrivateUploadStream,
} from "@/lib/uploads/private-storage";
import { incrementOperationalCounter } from "@/lib/operations/runtime-metrics";
import {
  ACCOUNT_EXPORT_EXCLUSIONS,
  ACCOUNT_EXPORT_FORMAT_VERSION,
  ACCOUNT_EXPORT_PAGE_SIZE,
  ACCOUNT_EXPORT_SCOPES,
  accountExportBudgets,
  accountExportTimeoutMs,
} from "./constants";

const buildPayloadSchema = z.object({ exportId: z.string().cuid() }).strict();
const deletePayloadSchema = z
  .object({
    exportId: z.string().cuid().optional(),
    storageMode: z.string().min(1).max(32),
    storageKey: z.string().min(1).max(1024),
  })
  .strict();

class ExportCancelledError extends Error {
  readonly retryable = false;

  constructor() {
    super("Account export was cancelled");
    this.name = "ExportCancelledError";
  }
}

class ExportLimitError extends Error {
  readonly retryable = false;

  constructor(detail: string) {
    super(detail);
    this.name = "ExportLimitError";
  }
}

type RecordCounts = Record<string, number>;

function serializeRecord(record: unknown): Buffer {
  return Buffer.from(
    `${JSON.stringify(record, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    )}\n`,
    "utf8",
  );
}

async function writeChunk(stream: NodeJS.WritableStream, chunk: Buffer) {
  if (!stream.write(chunk)) await once(stream, "drain");
}

async function assertNotCancelled(
  prisma: PrismaClient,
  exportId: string,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw signal.reason || new Error("Export aborted");
  const current = await prisma.accountExport.findUnique({
    where: { id: exportId },
    select: { status: true, cancelRequestedAt: true },
  });
  if (
    !current ||
    current.cancelRequestedAt ||
    current.status === AccountExportStatus.CANCELLED
  ) {
    throw new ExportCancelledError();
  }
}

async function buildArchive(
  prisma: PrismaClient,
  input: {
    exportId: string;
    userId: string;
    outputPath: string;
    signal?: AbortSignal;
  },
) {
  const budgets = accountExportBudgets();
  const gzip = createGzip({ level: 6 });
  const output = createWriteStream(input.outputPath, { flags: "wx" });
  const archiveHash = createHash("sha256");
  let archiveBytes = 0;
  let uncompressedBytes = 0;
  const counts: RecordCounts = {};
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      archiveBytes += chunk.length;
      if (archiveBytes > budgets.maxArchiveBytes) {
        callback(
          new ExportLimitError(
            `Account export exceeds the ${budgets.maxArchiveBytes}-byte archive budget`,
          ),
        );
        return;
      }
      archiveHash.update(chunk);
      callback(null, chunk);
    },
  });
  const completion = pipeline(gzip, meter, output, { signal: input.signal });

  const write = async (recordType: string, value: unknown) => {
    if (input.signal?.aborted) {
      throw input.signal.reason || new Error("Export aborted");
    }
    const chunk = serializeRecord({ recordType, value });
    uncompressedBytes += chunk.length;
    if (uncompressedBytes > budgets.maxUncompressedBytes) {
      throw new ExportLimitError(
        `Account export exceeds the ${budgets.maxUncompressedBytes}-byte input budget`,
      );
    }
    await writeChunk(gzip, chunk);
    counts[recordType] = (counts[recordType] || 0) + 1;
  };

  const writePages = async <T extends { id: string }>(
    recordType: string,
    fetchPage: (cursor: string | undefined) => Promise<T[]>,
  ) => {
    let cursor: string | undefined;
    for (;;) {
      await assertNotCancelled(prisma, input.exportId, input.signal);
      const rows = await fetchPage(cursor);
      for (const row of rows) await write(recordType, row);
      if (rows.length < ACCOUNT_EXPORT_PAGE_SIZE) return;
      cursor = rows.at(-1)!.id;
    }
  };

  try {
    await write("manifest", {
      format: "memoria-account-export",
      formatVersion: ACCOUNT_EXPORT_FORMAT_VERSION,
      exportId: input.exportId,
      generatedAt: new Date().toISOString(),
      encoding: "gzip-compressed JSON Lines",
      checksum: "SHA-256 of the complete compressed archive",
      scopes: ACCOUNT_EXPORT_SCOPES,
      exclusions: ACCOUNT_EXPORT_EXCLUSIONS,
      uploadEncoding:
        "uploadObjectChunk.data is independently base64 encoded and ordered by sequence",
    });

    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        name: true,
        image: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) throw new ExportCancelledError();
    await write("profile", user);

    await writePages("workspace", (cursor) =>
      prisma.workspace.findMany({
        where: { userId: input.userId },
        orderBy: { id: "asc" },
        take: ACCOUNT_EXPORT_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          name: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    );
    await writePages("canvas", (cursor) =>
      prisma.canvas.findMany({
        where: { userId: input.userId },
        orderBy: { id: "asc" },
        take: ACCOUNT_EXPORT_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          name: true,
          workspaceId: true,
          zoomLevel: true,
          panX: true,
          panY: true,
          isPublic: true,
          isTemplate: true,
          templateDescription: true,
          templateCategory: true,
          usageCount: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    );
    await writePages("canvasItem", (cursor) =>
      prisma.canvasItem.findMany({
        where: { canvas: { userId: input.userId } },
        orderBy: { id: "asc" },
        take: ACCOUNT_EXPORT_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          canvasId: true,
          type: true,
          positionX: true,
          positionY: true,
          width: true,
          height: true,
          zIndex: true,
          content: true,
          tags: true,
          version: true,
          deletedAt: true,
          createdById: true,
          updatedById: true,
          deletedById: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    );
    await writePages("canvasVersion", (cursor) =>
      prisma.canvasVersion.findMany({
        where: { canvas: { userId: input.userId } },
        orderBy: { id: "asc" },
        take: ACCOUNT_EXPORT_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          canvasId: true,
          name: true,
          snapshot: true,
          createdAt: true,
        },
      }),
    );
    await writePages("canvasShare", (cursor) =>
      prisma.canvasShare.findMany({
        where: { canvas: { userId: input.userId } },
        orderBy: { id: "asc" },
        take: ACCOUNT_EXPORT_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          canvasId: true,
          email: true,
          recipientId: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    );
    await writePages("comment", (cursor) =>
      prisma.comment.findMany({
        where: {
          OR: [
            { userId: input.userId },
            { item: { canvas: { userId: input.userId } } },
          ],
        },
        orderBy: { id: "asc" },
        take: ACCOUNT_EXPORT_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          itemId: true,
          userId: true,
          content: true,
          deletedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    );
    await writePages("activity", (cursor) =>
      prisma.activity.findMany({
        where: { userId: input.userId },
        orderBy: { id: "asc" },
        take: ACCOUNT_EXPORT_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          type: true,
          canvasId: true,
          canvasName: true,
          itemId: true,
          metadata: true,
          createdAt: true,
        },
      }),
    );
    await writePages("notificationPreference", (cursor) =>
      prisma.notificationPreference.findMany({
        where: { userId: input.userId },
        orderBy: { id: "asc" },
        take: ACCOUNT_EXPORT_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          type: true,
          inAppEnabled: true,
          emailEnabled: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    );

    let uploadCursor: string | undefined;
    for (;;) {
      await assertNotCancelled(prisma, input.exportId, input.signal);
      const assets = await prisma.uploadAsset.findMany({
        where: { userId: input.userId },
        orderBy: { id: "asc" },
        take: ACCOUNT_EXPORT_PAGE_SIZE,
        ...(uploadCursor ? { cursor: { id: uploadCursor }, skip: 1 } : {}),
        select: {
          id: true,
          canvasId: true,
          storageKey: true,
          storageMode: true,
          filename: true,
          mimeType: true,
          size: true,
          status: true,
          createdAt: true,
        },
      });
      for (const asset of assets) {
        await write("uploadMetadata", {
          id: asset.id,
          canvasId: asset.canvasId,
          filename: asset.filename,
          mimeType: asset.mimeType,
          size: asset.size,
          status: asset.status,
          createdAt: asset.createdAt,
          objectIncluded: asset.status === UploadAssetStatus.ACTIVE,
        });
        if (asset.status !== UploadAssetStatus.ACTIVE) continue;
        await assertNotCancelled(prisma, input.exportId, input.signal);
        const object = await readPrivateUploadObject(
          asset.storageMode,
          asset.storageKey,
        );
        const objectHash = createHash("sha256");
        let objectBytes = 0;
        let sequence = 0;
        await write("uploadObjectStart", {
          assetId: asset.id,
          filename: asset.filename,
          mimeType: asset.mimeType,
          expectedBytes: asset.size,
        });
        const stream = Readable.fromWeb(object.body as never);
        for await (const rawChunk of stream) {
          const chunk = Buffer.from(rawChunk as Uint8Array);
          objectHash.update(chunk);
          objectBytes += chunk.length;
          await write("uploadObjectChunk", {
            assetId: asset.id,
            sequence,
            data: chunk.toString("base64"),
          });
          sequence += 1;
        }
        if (objectBytes !== asset.size) {
          throw new ExportLimitError(
            `Upload ${asset.id} size changed during export`,
          );
        }
        await write("uploadObjectEnd", {
          assetId: asset.id,
          bytes: objectBytes,
          chunks: sequence,
          sha256: objectHash.digest("hex"),
        });
      }
      if (assets.length < ACCOUNT_EXPORT_PAGE_SIZE) break;
      uploadCursor = assets.at(-1)!.id;
    }

    const manifest = {
      formatVersion: ACCOUNT_EXPORT_FORMAT_VERSION,
      scopes: ACCOUNT_EXPORT_SCOPES,
      exclusions: ACCOUNT_EXPORT_EXCLUSIONS,
      counts,
      uncompressedBytes,
    };
    await write("manifestEnd", manifest);
    gzip.end();
    await completion;
    return {
      manifest,
      sha256: archiveHash.digest("hex"),
      byteSize: archiveBytes,
    };
  } catch (error) {
    gzip.destroy(error as Error);
    await completion.catch(() => undefined);
    throw error;
  }
}

export function createAccountExportBuildHandler(
  prisma: PrismaClient,
): OutboxHandler {
  return async (job, context) => {
    const { exportId } = buildPayloadSchema.parse(job.payload);
    const exportRecord = await prisma.accountExport.findUnique({
      where: { id: exportId },
    });
    if (
      !exportRecord ||
      exportRecord.status === AccountExportStatus.COMPLETED ||
      exportRecord.status === AccountExportStatus.CANCELLED ||
      exportRecord.status === AccountExportStatus.EXPIRED
    ) {
      return;
    }
    if (exportRecord.cancelRequestedAt) {
      await prisma.accountExport.updateMany({
        where: {
          id: exportId,
          status: {
            in: [AccountExportStatus.QUEUED, AccountExportStatus.RUNNING],
          },
        },
        data: { status: AccountExportStatus.CANCELLED },
      });
      return;
    }

    // Only one worker may own the build transition. A stale outbox lease can
    // cause a second delivery while the original handler is still finishing;
    // refusing to restart a fresh RUNNING export prevents competing writers
    // from overwriting or deleting the completed archive. A process killed
    // after the transition is recoverable once its timeout window is stale.
    const staleBefore = new Date(
      Date.now() - Math.max(accountExportTimeoutMs() * 2, 60_000),
    );
    const canTakeOwnership =
      exportRecord.status === AccountExportStatus.QUEUED ||
      (exportRecord.status === AccountExportStatus.RUNNING &&
        (!exportRecord.startedAt || exportRecord.startedAt < staleBefore));
    if (!canTakeOwnership) return;
    const started = await prisma.accountExport.updateMany({
      where: {
        id: exportId,
        ...(exportRecord.status === AccountExportStatus.QUEUED
          ? { status: AccountExportStatus.QUEUED }
          : {
              status: AccountExportStatus.RUNNING,
              ...(exportRecord.startedAt
                ? { startedAt: { lt: staleBefore } }
                : { startedAt: null }),
            }),
        cancelRequestedAt: null,
      },
      data: {
        status: AccountExportStatus.RUNNING,
        startedAt: new Date(),
        lastError: null,
      },
    });
    if (started.count !== 1) return;

    const tempDirectory = await mkdtemp(join(tmpdir(), "memoria-export-"));
    const outputPath = join(tempDirectory, `${exportId}.jsonl.gz`);
    // Each delivery gets an isolated key. If a stale worker eventually wakes
    // after a takeover, its losing object can be deleted without touching the
    // archive installed by the winning transaction.
    const storageKey = `account-exports/${exportRecord.userId}/${exportId}/${job.id}-${job.attempts}.jsonl.gz`;
    let storageAttempted = false;
    try {
      const result = await buildArchive(prisma, {
        exportId,
        userId: exportRecord.userId,
        outputPath,
        signal: context?.signal,
      });
      await assertNotCancelled(prisma, exportId, context?.signal);
      const metadata = await stat(outputPath);
      storageAttempted = true;
      await writePrivateUploadStream(
        exportRecord.storageMode,
        storageKey,
        createReadStream(outputPath),
        "application/gzip",
        metadata.size,
        context?.signal,
      );
      const installation = await prisma.$transaction(async (tx) => {
        const update = await tx.accountExport.updateMany({
          where: {
            id: exportId,
            status: AccountExportStatus.RUNNING,
            cancelRequestedAt: null,
          },
          data: {
            status: AccountExportStatus.COMPLETED,
            storageKey,
            byteSize: BigInt(result.byteSize),
            sha256: result.sha256,
            manifest: result.manifest as unknown as Prisma.InputJsonValue,
            completedAt: new Date(),
            lastError: null,
          },
        });
        if (update.count !== 1) {
          const current = await tx.accountExport.findUnique({
            where: { id: exportId },
            select: {
              status: true,
              cancelRequestedAt: true,
              storageKey: true,
            },
          });
          return {
            installed: false as const,
            status: current?.status,
            cancelRequestedAt: current?.cancelRequestedAt,
            storageKey: current?.storageKey,
          };
        }
        await enqueueOutboxJob(tx, {
          type: "account-export.delete",
          dedupeKey: `account-export.delete:${exportId}`,
          nextRunAt: exportRecord.expiresAt,
          payload: {
            exportId,
            storageMode: exportRecord.storageMode,
            storageKey,
          },
        });
        return { installed: true as const };
      });
      if (!installation.installed) {
        // Keep an object only when this transaction installed this exact key.
        // A competing/stale delivery must never delete an archive that another
        // worker has already marked COMPLETED.
        const keepObject =
          installation.status === AccountExportStatus.COMPLETED &&
          installation.storageKey === storageKey;
        if (!keepObject) {
          await deletePrivateUploadObject(
            exportRecord.storageMode,
            storageKey,
            context?.signal,
          );
          storageAttempted = false;
        }
        if (
          !installation.status ||
          installation.status === AccountExportStatus.CANCELLED ||
          installation.cancelRequestedAt
        ) {
          throw new ExportCancelledError();
        }
        return;
      }
      // Ownership of the object is now represented by the durable completed
      // row and its delete job; later errors must not remove it.
      storageAttempted = false;
      incrementOperationalCounter("account_exports_completed_total");
      incrementOperationalCounter(
        "account_export_bytes_total",
        result.byteSize,
      );
    } catch (error) {
      if (storageAttempted) {
        await deletePrivateUploadObject(
          exportRecord.storageMode,
          storageKey,
        ).catch(() => undefined);
      }
      if (error instanceof ExportCancelledError) {
        await prisma.accountExport.updateMany({
          where: {
            id: exportId,
            status: {
              in: [AccountExportStatus.QUEUED, AccountExportStatus.RUNNING],
            },
          },
          data: {
            status: AccountExportStatus.CANCELLED,
            storageKey: null,
          },
        });
        incrementOperationalCounter("account_exports_cancelled_total");
        return;
      }
      const terminal =
        error instanceof ExportLimitError || job.attempts >= job.maxAttempts;
      await prisma.accountExport.updateMany({
        where: { id: exportId },
        data: {
          status: terminal
            ? AccountExportStatus.FAILED
            : AccountExportStatus.QUEUED,
          lastError:
            error instanceof Error
              ? error.message.slice(0, 500)
              : "Account export failed",
        },
      });
      incrementOperationalCounter("account_exports_failed_total");
      // A size limit is an expected terminal outcome for this user request;
      // keep it out of the worker dead-letter queue after recording FAILED.
      if (error instanceof ExportLimitError) return;
      throw error;
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  };
}

export function createAccountExportDeleteHandler(
  prisma: PrismaClient,
): OutboxHandler {
  return async (job, context) => {
    const payload = deletePayloadSchema.parse(job.payload);
    await deletePrivateUploadObject(
      payload.storageMode,
      payload.storageKey,
      context?.signal,
    );
    if (payload.exportId) {
      await prisma.accountExport.updateMany({
        where: { id: payload.exportId },
        data: {
          status: AccountExportStatus.EXPIRED,
          storageKey: null,
        },
      });
    }
  };
}
