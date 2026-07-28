import type { Prisma, PrismaClient } from "@prisma/client";
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
export async function assertCanvasItemCapacity(tx: Store, canvasId: string) {
  await lock(tx, "canvas-item", canvasId);
  if (
    (await tx.canvasItem.count({ where: { canvasId, deletedAt: null } })) >=
    LAUNCH_LIMITS.itemsPerCanvas
  )
    exceeded("canvas items", LAUNCH_LIMITS.itemsPerCanvas);
}
export async function assertCanvasShareCapacity(tx: Store, canvasId: string) {
  await lock(tx, "canvas-share", canvasId);
  if (
    (await tx.canvasShare.count({ where: { canvasId } })) >=
    LAUNCH_LIMITS.sharesPerCanvas
  )
    exceeded("canvas shares", LAUNCH_LIMITS.sharesPerCanvas);
}
export async function assertCanvasVersionCapacity(tx: Store, canvasId: string) {
  await lock(tx, "canvas-version", canvasId);
  if (
    (await tx.canvasVersion.count({ where: { canvasId } })) >=
    LAUNCH_LIMITS.versionsPerCanvas
  )
    exceeded("canvas versions", LAUNCH_LIMITS.versionsPerCanvas);
}
