import type { Prisma } from "@prisma/client";

export async function lockCanvasForMutation(
  tx: Prisma.TransactionClient,
  canvasId: string,
) {
  await tx.$queryRaw`
    SELECT "id" FROM "Canvas" WHERE "id" = ${canvasId} FOR UPDATE
  `;
}
