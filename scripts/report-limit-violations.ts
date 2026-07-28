import { prisma } from "../src/lib/db";
import { LAUNCH_LIMITS } from "../src/lib/policy/launch-limits";

const [items, versions, shares] = await Promise.all([
  prisma.$queryRaw<Array<{ id: string; count: bigint }>>`
    SELECT "canvasId" AS id, COUNT(*) AS count FROM "CanvasItem"
    WHERE "deletedAt" IS NULL GROUP BY "canvasId" HAVING COUNT(*) > ${LAUNCH_LIMITS.itemsPerCanvas}
  `,
  prisma.$queryRaw<Array<{ id: string; count: bigint }>>`
    SELECT "canvasId" AS id, COUNT(*) AS count FROM "CanvasVersion"
    GROUP BY "canvasId" HAVING COUNT(*) > ${LAUNCH_LIMITS.versionsPerCanvas}
  `,
  prisma.$queryRaw<Array<{ id: string; count: bigint }>>`
    SELECT "canvasId" AS id, COUNT(*) AS count FROM "CanvasShare"
    GROUP BY "canvasId" HAVING COUNT(*) > ${LAUNCH_LIMITS.sharesPerCanvas}
  `,
]);
console.warn(
  JSON.stringify(
    {
      itemViolations: items.map((row) => ({
        ...row,
        count: Number(row.count),
      })),
      versionViolations: versions.map((row) => ({
        ...row,
        count: Number(row.count),
      })),
      shareViolations: shares.map((row) => ({
        ...row,
        count: Number(row.count),
      })),
    },
    null,
    2,
  ),
);
await prisma.$disconnect();
