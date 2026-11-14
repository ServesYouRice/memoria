import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { ApiError } from "@/lib/errors";
import { LAUNCH_LIMITS } from "./launch-limits";

type Store = Prisma.TransactionClient | PrismaClient;
function exceeded(resource: string, limit: number): never {
  throw new ApiError(
    422,
    "https://memoria.local/errors/quota-exceeded",
    "Quota Exceeded",
    `${resource} limit of ${limit} has been reached.`,
    { resource, limit },
  );
}
async function lock(tx: Store, scope: string, id: string) {
  // Hide PostgreSQL's `void` lock result behind an integer projection because
  // Prisma cannot deserialize a selected `void` column.
  await tx.$queryRaw`
    SELECT 1 AS "locked"
    FROM (SELECT pg_advisory_xact_lock(hashtext(${scope}), hashtext(${id}))) AS acquired
  `;
}
export async function assertCanvasCapacity(tx: Store, userId: string) {
  await lock(tx, "canvas", userId);
  if (
    (await tx.canvas.count({ where: { userId } })) >=
    LAUNCH_LIMITS.canvasesPerUser
  )
    exceeded("canvases", LAUNCH_LIMITS.canvasesPerUser);
}
export async function assertWorkspaceCapacity(tx: Store, userId: string) {
  await lock(tx, "workspace", userId);
  if (
    (await tx.workspace.count({ where: { userId } })) >=
    LAUNCH_LIMITS.workspacesPerUser
  )
    exceeded("workspaces", LAUNCH_LIMITS.workspacesPerUser);
}
/**
 * Items on a canvas: its own live items and the live items from other
 * canvases placed on it (IMP-109), since each placement takes a place too.
 */
async function canvasItemCount(tx: Store, canvasId: string) {
  const [own, placed] = await Promise.all([
    tx.canvasItem.count({ where: { canvasId, deletedAt: null } }),
    tx.itemPlacement.count({
      where: { canvasId, item: { deletedAt: null } },
    }),
  ]);
  return own + placed;
}
export async function assertCanvasItemCapacity(
  tx: Store,
  canvasId: string,
  additionalItems = 1,
) {
  await lock(tx, "canvas-item", canvasId);
  if (
    (await canvasItemCount(tx, canvasId)) + additionalItems >
    LAUNCH_LIMITS.itemsPerCanvas
  )
    exceeded("canvas items", LAUNCH_LIMITS.itemsPerCanvas);
}
/**
 * How many more items fit on a canvas, under the same lock as
 * `assertCanvasItemCapacity`. For bulk saves that keep what fits and report
 * the rest (IMP-091).
 */
export async function canvasItemRoom(tx: Store, canvasId: string) {
  await lock(tx, "canvas-item", canvasId);
  const count = await canvasItemCount(tx, canvasId);
  return Math.max(0, LAUNCH_LIMITS.itemsPerCanvas - count);
}
export async function assertCanvasShareCapacity(
  tx: Store,
  canvasId: string,
  replacingEmail?: string,
) {
  await lock(tx, "canvas-share", canvasId);
  const [accepted, pending] = await Promise.all([
    tx.canvasShare.count({
      where: {
        canvasId,
        recipientId: { not: null },
        ...(replacingEmail ? { email: { not: replacingEmail } } : {}),
      },
    }),
    tx.canvasShareInvitation.count({
      where: {
        canvasId,
        respondedAt: null,
        expiresAt: { gt: new Date() },
        ...(replacingEmail ? { email: { not: replacingEmail } } : {}),
      },
    }),
  ]);
  if (accepted + pending >= LAUNCH_LIMITS.sharesPerCanvas)
    exceeded("canvas shares", LAUNCH_LIMITS.sharesPerCanvas);
}
export async function assertCanvasVersionCapacity(tx: Store, canvasId: string) {
  await lock(tx, "canvas-version", canvasId);
  if (
    // Automatic snapshots are thinned by their own retention policy (IMP-046).
    (await tx.canvasVersion.count({
      where: { canvasId, kind: "MANUAL" },
    })) >= LAUNCH_LIMITS.versionsPerCanvas
  )
    exceeded("canvas versions", LAUNCH_LIMITS.versionsPerCanvas);
}
