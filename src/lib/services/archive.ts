import {
  AgentActionKind,
  AgentActionStatus,
  ChangeSetStatus,
  type Prisma,
} from "@/generated/prisma/client";
import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { BadRequestError } from "@/lib/errors";
import { AGENT_CAPABILITY_RUNGS } from "@/lib/agents/constants";
import type { ActorContext } from "@/lib/agents/service-core";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import { recordCanvasItemEvent } from "@/lib/collaboration/committed-events";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import { assertCanvasItemCapacity } from "@/lib/policy/capacity";

/**
 * IMP-070 — the one archive. Archiving sends items to the trash with
 * `archivedAt` set: they leave their boards, show up in Trash, and the trash
 * sweep never deletes them, so nothing is lost without the user asking. The
 * item row, its content (an enriched link's summary included) and its
 * enrichment stay as they were. One call is one change set, and undoing that
 * change set puts every item back on its board.
 */

/** Change-record operation for an archived item; undo restores it. */
export const ARCHIVE_OPERATION = "ARCHIVE";
/** Most items one archive call takes. */
export const ARCHIVE_MAX_ITEMS = 200;

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export interface ArchiveItemsResult {
  agentActionId: string;
  changeSetId: string;
  archivedItemIds: string[];
  archivedItemCount: number;
}

/**
 * Archives the given items the actor owns and still has on a board. Items
 * that are gone, already in the trash or on someone else's board are skipped;
 * when none are left the call fails without writing anything.
 */
export async function archiveItems(input: {
  actor: ActorContext;
  itemIds: string[];
  summary: string;
}): Promise<ArchiveItemsResult> {
  const userId = input.actor.userId;
  const itemIds = Array.from(new Set(input.itemIds));
  if (itemIds.length === 0) throw new BadRequestError("Nothing to archive.");
  if (itemIds.length > ARCHIVE_MAX_ITEMS) {
    throw new BadRequestError(
      `Archive at most ${ARCHIVE_MAX_ITEMS} items at a time.`,
    );
  }
  const touched = new Set<string>();

  const result = await prisma.$transaction(async (tx) => {
    const candidates = await tx.canvasItem.findMany({
      where: {
        id: { in: itemIds },
        deletedAt: null,
        canvas: { userId, isTemplate: false },
      },
      select: { canvasId: true },
    });
    if (candidates.length === 0) {
      throw new BadRequestError("These items are already archived or gone.");
    }
    // One lock order for every board involved, so concurrent writes cannot deadlock.
    const canvasIds = Array.from(
      new Set(candidates.map((item) => item.canvasId)),
    ).sort();
    for (const canvasId of canvasIds) {
      await lockCanvasForMutation(tx, canvasId);
      touched.add(canvasId);
    }
    // Re-read under the locks: an item may have been deleted meanwhile.
    const items = await tx.canvasItem.findMany({
      where: {
        id: { in: itemIds },
        deletedAt: null,
        canvas: { userId, isTemplate: false },
      },
      orderBy: { id: "asc" },
    });
    if (items.length === 0) {
      throw new BadRequestError("These items are already archived or gone.");
    }

    const agentAction = await tx.agentAction.create({
      data: {
        userId,
        agentProfileId: input.actor.agentProfileId,
        integrationAccountId: input.actor.integrationAccountId ?? null,
        modelCredentialId: input.actor.modelCredentialId ?? null,
        kind: AgentActionKind.WRITE,
        rung: AGENT_CAPABILITY_RUNGS.WRITE_GROUP,
        status: AgentActionStatus.RUNNING,
        summary: input.summary,
        requestFingerprint: createHash("sha256")
          .update(JSON.stringify({ archive: items.map((item) => item.id) }))
          .digest("hex"),
      },
    });
    const changeSet = await tx.changeSet.create({
      data: {
        userId,
        agentProfileId: input.actor.agentProfileId,
        agentActionId: agentAction.id,
        scopeType: "user",
        scopeId: userId,
        status: ChangeSetStatus.RUNNING,
        summary: input.summary,
      },
    });

    const now = new Date();
    for (const item of items) {
      const archived = await tx.canvasItem.update({
        where: { id: item.id },
        data: {
          deletedAt: now,
          deletedById: userId,
          archivedAt: now,
          version: { increment: 1 },
          updatedById: userId,
        },
      });
      await recordCanvasItemEvent(tx, {
        canvasId: item.canvasId,
        actorId: userId,
        itemId: item.id,
        version: archived.version,
        operation: "deleted",
      });
      await tx.changeRecord.create({
        data: {
          changeSetId: changeSet.id,
          targetType: "CanvasItem",
          targetId: item.id,
          operation: ARCHIVE_OPERATION,
          before: toJsonValue(item),
          after: toJsonValue(archived),
          reversible: true,
        },
      });
    }

    await tx.changeSet.update({
      where: { id: changeSet.id },
      data: { status: ChangeSetStatus.COMPLETED, completedAt: new Date() },
    });
    await tx.agentAction.update({
      where: { id: agentAction.id },
      data: { status: AgentActionStatus.COMPLETED },
    });

    return {
      agentActionId: agentAction.id,
      changeSetId: changeSet.id,
      archivedItemIds: items.map((item) => item.id),
      archivedItemCount: items.length,
    };
  });

  await Promise.all(
    Array.from(touched).map((canvasId) => invalidateCanvasCache(canvasId)),
  );
  return result;
}

function isoOrNull(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? new Date(value).toISOString() : null;
}

/**
 * Whether the item is still in the state this archive left it: deleted and
 * archived at the archive's timestamps (and at its version when recorded).
 * A later restore followed by a delete or a second archive changes these, so
 * that deletion is never undone here. Records without an `after` snapshot
 * (older rows) only require the item to be archived, a weaker guard.
 */
function isThisArchive(
  existing: {
    deletedAt: Date | null;
    archivedAt: Date | null;
    version: number;
  },
  after: Prisma.JsonValue | null,
) {
  if (!after || typeof after !== "object" || Array.isArray(after)) {
    return existing.archivedAt !== null;
  }
  const snapshot = after as Record<string, unknown>;
  if (isoOrNull(existing.archivedAt) !== isoOrNull(snapshot.archivedAt)) {
    return false;
  }
  // Every Trash restore, delete or edit bumps the version, so an unchanged
  // version proves nothing happened since; the deletion time alone may be
  // rewritten (backdated) without anyone touching the item.
  if (typeof snapshot.version === "number") {
    return existing.version === snapshot.version;
  }
  return isoOrNull(existing.deletedAt) === isoOrNull(snapshot.deletedAt);
}

/**
 * Undo of one archived item, inside `revertChangeSet`. An item the user
 * already restored from Trash, or deleted or archived again since, is left
 * alone. The decision is made from a read under the item's canvas lock.
 */
export async function revertArchivedItem(
  tx: Prisma.TransactionClient,
  input: {
    targetId: string;
    userId: string;
    rollbackChangeSetId: string;
    /** The archive record's `after` snapshot: the state it left the item in. */
    after: Prisma.JsonValue | null;
  },
) {
  const located = await tx.canvasItem.findFirst({
    where: { id: input.targetId, canvas: { userId: input.userId } },
    select: { canvasId: true },
  });
  if (!located) return;
  await lockCanvasForMutation(tx, located.canvasId);
  const existing = await tx.canvasItem.findUnique({
    where: { id: input.targetId },
  });
  if (!existing) return;
  if (existing.deletedAt === null || !isThisArchive(existing, input.after)) {
    await tx.changeRecord.create({
      data: {
        changeSetId: input.rollbackChangeSetId,
        targetType: "CanvasItem",
        targetId: existing.id,
        operation: "ROLLBACK_ARCHIVE",
        before: toJsonValue(existing),
        after: toJsonValue(existing),
        reversible: false,
      },
    });
    return;
  }
  // Archived items do not count toward the per-canvas limit. Each restore is
  // checked against the live count, which includes the items this undo has
  // already restored, so an undo that would overfill the canvas throws and
  // revertChangeSet's transaction rolls every restore back.
  await assertCanvasItemCapacity(tx, existing.canvasId, 1);
  const restored = await tx.canvasItem.update({
    where: { id: existing.id },
    data: {
      deletedAt: null,
      deletedById: null,
      archivedAt: null,
      version: { increment: 1 },
      updatedById: input.userId,
    },
  });
  await recordCanvasItemEvent(tx, {
    canvasId: restored.canvasId,
    actorId: input.userId,
    itemId: restored.id,
    version: restored.version,
    operation: "created",
  });
  await tx.changeRecord.create({
    data: {
      changeSetId: input.rollbackChangeSetId,
      targetType: "CanvasItem",
      targetId: existing.id,
      operation: "ROLLBACK_ARCHIVE",
      before: toJsonValue(existing),
      after: toJsonValue(restored),
      reversible: false,
    },
  });
}
