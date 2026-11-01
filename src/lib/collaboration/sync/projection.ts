/**
 * IMP-042 — project accepted document changes onto `CanvasItem` rows.
 *
 * Runs inside the transaction that appends the document update, after the
 * canvas row lock, so rows and document advance together and every change is
 * recorded as a committed canvas event like an HTTP write. Search, export,
 * agents, the HTTP API and the accessible item list keep reading rows.
 *
 * Field-level, last commit wins: only the fields an update touched are
 * written, so a concurrent HTTP write to another field of the same item
 * survives. An update to an item whose row was deleted meanwhile is dropped
 * (deletion wins) and reconciliation removes it from the document.
 *
 * @module lib/collaboration/sync/projection
 */

import type { Prisma } from "@/generated/prisma/client";
import { ApiError } from "@/lib/errors";
import { assertCanvasItemCapacity } from "@/lib/policy/capacity";
import { recordCanvasItemEventsBatch } from "@/lib/collaboration/committed-events";
import {
  InvalidDocumentUpdateError,
  type DocumentItemChange,
  type ItemFieldChanges,
} from "./validation";

type Tx = Prisma.TransactionClient;

type EventInput = Parameters<typeof recordCanvasItemEventsBatch>[1][number];

function rowData(fields: ItemFieldChanges) {
  return {
    ...(fields.positionX !== undefined && { positionX: fields.positionX }),
    ...(fields.positionY !== undefined && { positionY: fields.positionY }),
    ...(fields.width !== undefined && { width: fields.width }),
    ...(fields.height !== undefined && { height: fields.height }),
    ...(fields.zIndex !== undefined && { zIndex: fields.zIndex }),
    ...(fields.tags !== undefined && { tags: fields.tags }),
    ...(fields.content !== undefined && {
      content: fields.content as Prisma.InputJsonValue,
    }),
  };
}

export interface ProjectionResult {
  created: number;
  updated: number;
  deleted: number;
}

export async function projectDocumentChanges(
  tx: Tx,
  input: { canvasId: string; actorId: string; changes: DocumentItemChange[] },
): Promise<ProjectionResult> {
  const { canvasId, actorId, changes } = input;
  const result: ProjectionResult = { created: 0, updated: 0, deleted: 0 };
  if (changes.length === 0) return result;

  const ids = changes.map((change) =>
    change.kind === "create" ? change.state.id : change.id,
  );
  const rows = await tx.canvasItem.findMany({
    where: { id: { in: ids } },
    select: { id: true, canvasId: true, deletedAt: true, type: true },
  });
  const rowsById = new Map(rows.map((row) => [row.id, row] as const));
  const events: EventInput[] = [];
  const now = new Date();

  // Item ids are global: a document may never claim another canvas's item.
  for (const row of rows) {
    if (row.canvasId !== canvasId)
      throw new InvalidDocumentUpdateError(
        "Item id belongs to another canvas.",
      );
  }

  // New rows and restored ones count against the canvas item limit.
  const additions = changes.filter((change) => {
    if (change.kind !== "create") return false;
    const existing = rowsById.get(change.state.id);
    return !existing || existing.deletedAt !== null;
  }).length;
  if (additions > 0) {
    try {
      await assertCanvasItemCapacity(tx, canvasId, additions);
    } catch (error) {
      if (error instanceof ApiError)
        throw new InvalidDocumentUpdateError(error.message);
      throw error;
    }
  }

  for (const change of changes) {
    if (change.kind === "create") {
      const { state } = change;
      const existing = rowsById.get(state.id);
      if (existing && existing.type !== state.type)
        throw new InvalidDocumentUpdateError("Item type cannot change.");
      const fields = {
        positionX: state.positionX,
        positionY: state.positionY,
        width: state.width,
        height: state.height,
        zIndex: state.zIndex,
        tags: state.tags,
        content: state.content as Prisma.InputJsonValue,
      };
      if (!existing) {
        await tx.canvasItem.create({
          data: {
            id: state.id,
            canvasId,
            type: state.type,
            ...fields,
            createdById: actorId,
            updatedById: actorId,
          },
          select: { id: true },
        });
        events.push({
          canvasId,
          actorId,
          itemId: state.id,
          version: 1,
          operation: "created",
        });
        result.created += 1;
        continue;
      }
      // Re-creating a known id (an undone deletion) restores the row.
      const restored = await tx.canvasItem.update({
        where: { id: state.id },
        data: {
          ...fields,
          deletedAt: null,
          deletedById: null,
          updatedById: actorId,
          version: { increment: 1 },
        },
        select: { version: true },
      });
      events.push({
        canvasId,
        actorId,
        itemId: state.id,
        version: restored.version,
        operation: existing.deletedAt ? "created" : "updated",
      });
      result.created += existing.deletedAt ? 1 : 0;
      result.updated += existing.deletedAt ? 0 : 1;
      continue;
    }

    const existing = rowsById.get(change.id);
    if (!existing || existing.deletedAt) continue;

    if (change.kind === "update") {
      if (existing.type !== change.type) continue;
      const updated = await tx.canvasItem.update({
        where: { id: change.id },
        data: {
          ...rowData(change.fields),
          updatedById: actorId,
          version: { increment: 1 },
        },
        select: { version: true },
      });
      events.push({
        canvasId,
        actorId,
        itemId: change.id,
        version: updated.version,
        operation: "updated",
      });
      result.updated += 1;
      continue;
    }

    const deleted = await tx.canvasItem.update({
      where: { id: change.id },
      data: {
        deletedAt: now,
        deletedById: actorId,
        version: { increment: 1 },
      },
      select: { version: true },
    });
    events.push({
      canvasId,
      actorId,
      itemId: change.id,
      version: deleted.version,
      operation: "deleted",
    });
    result.deleted += 1;
  }

  await recordCanvasItemEventsBatch(tx, events);
  return result;
}
