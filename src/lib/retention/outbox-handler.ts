import type { PrismaClient } from "@/generated/prisma/client";
import type { OutboxHandler } from "@/lib/outbox/types";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";

export function createTrashRetentionHandler(
  prisma: PrismaClient,
): OutboxHandler {
  return async () => {
    const cutoff = new Date(
      Date.now() - LAUNCH_LIMITS.trashRetentionDays * 86_400_000,
    );
    await prisma.$executeRaw`
      WITH doomed AS (
        SELECT "id" FROM "CanvasItem"
        WHERE "deletedAt" < ${cutoff}
        ORDER BY "deletedAt" ASC
        LIMIT 500
      )
      DELETE FROM "CanvasItem" item USING doomed WHERE item."id" = doomed."id"
    `;
  };
}

export function createVersionRetentionHandler(
  prisma: PrismaClient,
): OutboxHandler {
  return async () => {
    await prisma.$executeRaw`
      WITH ranked AS (
        SELECT "id", ROW_NUMBER() OVER (PARTITION BY "canvasId" ORDER BY "createdAt" DESC, "id" DESC) AS rank
        FROM "CanvasVersion"
      ), doomed AS (
        SELECT "id" FROM ranked WHERE rank > ${LAUNCH_LIMITS.versionsPerCanvas} LIMIT 500
      )
      DELETE FROM "CanvasVersion" version USING doomed WHERE version."id" = doomed."id"
    `;
  };
}

export function createMaintenanceRetentionHandler(
  prisma: PrismaClient,
): OutboxHandler {
  return async () => {
    const idempotencyCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const candidateCutoff = new Date(Date.now() - 60 * 60 * 1000);
    await prisma.$transaction([
      prisma.$executeRaw`
        DELETE FROM "IdempotencyKey" WHERE "id" IN (
          SELECT "id" FROM "IdempotencyKey" WHERE "createdAt" < ${idempotencyCutoff}
          ORDER BY "createdAt" ASC LIMIT 500
        )
      `,
      prisma.$executeRaw`
        DELETE FROM "CanvasThumbnailCandidate" WHERE "id" IN (
          SELECT "id" FROM "CanvasThumbnailCandidate" WHERE "createdAt" < ${candidateCutoff}
          ORDER BY "createdAt" ASC LIMIT 500
        )
      `,
    ]);
  };
}
