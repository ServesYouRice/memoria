import { type NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { requireAuth, requireCanvasAccess } from "@/lib/api/auth";
import { runIdempotent, withApiHandler } from "@/lib/api/route-handler";
import { ConflictError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import { assertCanvasItemCapacity } from "@/lib/policy/capacity";
import {
  createCanvasItemSchema,
  parseCanvasItemContent,
} from "@/lib/validation/canvas-item";
import { recordCanvasItemEvent } from "@/lib/collaboration/committed-events";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";

const updateSchema = z
  .object({
    id: z.string().cuid(),
    version: z.number().int().positive(),
    positionX: z.number().finite().optional(),
    positionY: z.number().finite().optional(),
    width: z.number().positive().finite().optional(),
    height: z.number().positive().finite().optional(),
    zIndex: z.number().int().min(0).optional(),
  })
  .strict();

const commandSchema = z
  .object({
    canvasId: z.string().cuid(),
    updates: z.array(updateSchema).max(500).default([]),
    deletes: z
      .array(
        z
          .object({
            id: z.string().cuid(),
            version: z.number().int().positive(),
          })
          .strict(),
      )
      .max(500)
      .default([]),
    creates: z
      .array(createCanvasItemSchema.omit({ canvasId: true, zIndex: true }))
      .max(500)
      .default([]),
  })
  .strict()
  .refine(
    (value) =>
      value.updates.length + value.deletes.length + value.creates.length > 0 &&
      value.updates.length + value.deletes.length + value.creates.length <= 500,
    "A command must contain between 1 and 500 operations",
  );

export const POST = withApiHandler(async (request: NextRequest) => {
  const { userId, email } = await requireAuth();
  return runIdempotent(request, userId, async () => {
    const command = commandSchema.parse(await request.json());
    await requireCanvasAccess(command.canvasId, userId, email, "EDIT");
    const allIds = [...command.updates, ...command.deletes].map(
      (entry) => entry.id,
    );
    if (new Set(allIds).size !== allIds.length) {
      throw new ValidationError("An item may appear only once in a command");
    }
    const result = await prisma.$transaction(
      async (tx) => {
        await lockCanvasForMutation(tx, command.canvasId);
        for (const entry of command.deletes) {
          const deleted = await tx.canvasItem.updateMany({
            where: {
              id: entry.id,
              canvasId: command.canvasId,
              version: entry.version,
              deletedAt: null,
            },
            data: {
              deletedAt: new Date(),
              deletedById: userId,
              updatedById: userId,
              version: { increment: 1 },
            },
          });
          if (deleted.count !== 1)
            throw new ConflictError(
              "Canvas changed while applying the command",
            );
          await recordCanvasItemEvent(tx, {
            canvasId: command.canvasId,
            actorId: userId,
            itemId: entry.id,
            version: entry.version + 1,
            operation: "deleted",
          });
        }
        await assertCanvasItemCapacity(
          tx,
          command.canvasId,
          command.creates.length,
        );
        for (const entry of command.updates) {
          const updated = await tx.canvasItem.updateMany({
            where: {
              id: entry.id,
              canvasId: command.canvasId,
              version: entry.version,
              deletedAt: null,
            },
            data: {
              ...(entry.positionX !== undefined
                ? { positionX: entry.positionX }
                : {}),
              ...(entry.positionY !== undefined
                ? { positionY: entry.positionY }
                : {}),
              ...(entry.width !== undefined ? { width: entry.width } : {}),
              ...(entry.height !== undefined ? { height: entry.height } : {}),
              ...(entry.zIndex !== undefined ? { zIndex: entry.zIndex } : {}),
              updatedById: userId,
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1)
            throw new ConflictError(
              "Canvas changed while applying the command",
            );
          await recordCanvasItemEvent(tx, {
            canvasId: command.canvasId,
            actorId: userId,
            itemId: entry.id,
            version: entry.version + 1,
            operation: "updated",
          });
        }
        const maxZ = await tx.canvasItem.aggregate({
          where: { canvasId: command.canvasId, deletedAt: null },
          _max: { zIndex: true },
        });
        const created = [];
        for (const [index, entry] of command.creates.entries()) {
          const content = parseCanvasItemContent(entry.type, entry.content);
          const item = await tx.canvasItem.create({
            data: {
              ...entry,
              canvasId: command.canvasId,
              zIndex: (maxZ._max.zIndex ?? 0) + index + 1,
              content: content as Prisma.InputJsonValue,
              createdById: userId,
              updatedById: userId,
            },
          });
          created.push(item);
          await recordCanvasItemEvent(tx, {
            canvasId: command.canvasId,
            actorId: userId,
            itemId: item.id,
            version: item.version,
            operation: "created",
          });
        }
        return {
          updated: command.updates.length,
          deleted: command.deletes.length,
          created,
        };
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
    await invalidateCanvasCache(command.canvasId);
    return NextResponse.json(result);
  });
});
