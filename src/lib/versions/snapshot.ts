/**
 * IMP-046 — capturing a canvas snapshot for a version.
 *
 * Shared by the manual version route and the automatic snapshot job so both
 * store exactly the same shape (and the same content hash).
 *
 * @module lib/versions/snapshot
 */

import { createHash } from "node:crypto";
import * as Y from "yjs";
import type { Prisma } from "@/generated/prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";
import {
  readCurrentCanvasDocument,
  toBytes,
} from "@/lib/collaboration/sync/store";
import { readAllItemStates } from "@/lib/collaboration/sync/document-items";

export interface CapturedCanvasSnapshot {
  snapshot: Prisma.InputJsonObject;
  yjsState: Uint8Array<ArrayBuffer>;
  /** SHA-256 over the canvas name and items; see `hashCanvasContent`. */
  contentHash: string;
  itemCount: number;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Hash of what a person would call "the content" of a canvas: its name and its
 * items' type, geometry, tags and content. Row bookkeeping (item versions,
 * authors) and the viewport (zoom, pan) are left out so panning around or a
 * no-op write does not count as a change.
 */
export function hashCanvasContent(
  name: string,
  items: ReadonlyArray<{
    id: string;
    type: unknown;
    positionX: number;
    positionY: number;
    width: number;
    height: number;
    zIndex: number;
    tags: readonly string[];
    content: unknown;
  }>,
): string {
  const normalized = items
    .map((item) => ({
      id: item.id,
      type: item.type,
      positionX: item.positionX,
      positionY: item.positionY,
      width: item.width,
      height: item.height,
      zIndex: item.zIndex,
      tags: [...item.tags],
      content: item.content,
    }))
    .sort((left, right) => (left.id < right.id ? -1 : 1));
  return createHash("sha256")
    .update(canonicalJson({ name, items: normalized }))
    .digest("hex");
}

/**
 * Snapshot the canvas from its collaborative document (brought up to date with
 * any row write the document has not absorbed yet), with item metadata taken
 * from the rows. Call inside a transaction holding the canvas mutation lock.
 *
 * @throws NotFoundError when the canvas does not exist.
 * @throws ValidationError when the canvas exceeds the snapshot limits.
 */
export async function captureCanvasSnapshot(
  tx: Prisma.TransactionClient,
  canvasId: string,
): Promise<CapturedCanvasSnapshot> {
  const canvas = await tx.canvas.findUnique({
    where: { id: canvasId },
    include: { items: { where: { deletedAt: null } } },
  });
  if (!canvas) throw new NotFoundError("Canvas not found");
  if (canvas.items.length > LAUNCH_LIMITS.itemsPerCanvas) {
    throw new ValidationError(
      "Canvas exceeds the supported snapshot item limit",
    );
  }
  const document = await readCurrentCanvasDocument(tx, canvasId);
  const rows = new Map(canvas.items.map((item) => [item.id, item]));
  const states = readAllItemStates(document).filter((item) =>
    rows.has(item.id),
  );
  const snapshot = {
    schemaVersion: 1,
    name: canvas.name,
    zoomLevel: canvas.zoomLevel,
    panX: canvas.panX,
    panY: canvas.panY,
    items: states.map((item) => {
      const row = rows.get(item.id)!;
      return {
        ...item,
        content: item.content as Prisma.InputJsonValue,
        version: row.version,
        createdById: row.createdById,
        updatedById: row.updatedById,
      };
    }),
  };
  const yjsState = Y.encodeStateAsUpdate(document);
  document.destroy();
  if (
    Buffer.byteLength(JSON.stringify(snapshot), "utf8") >
      LAUNCH_LIMITS.versionSnapshotBytes ||
    yjsState.byteLength > LAUNCH_LIMITS.versionSnapshotBytes
  ) {
    throw new ValidationError(
      "Canvas snapshot exceeds the supported byte limit",
    );
  }
  return {
    snapshot,
    yjsState: toBytes(yjsState),
    contentHash: hashCanvasContent(canvas.name, states),
    itemCount: states.length,
  };
}
