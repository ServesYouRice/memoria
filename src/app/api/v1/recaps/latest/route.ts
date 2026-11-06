import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { prisma } from "@/lib/db";
import {
  describeLink,
  parseRecapPiles,
  parseRecapSavedLinks,
  staleCutoff,
  staleLinkWhere,
} from "@/lib/recap/weekly-recap";

/**
 * IMP-070 — the user's latest weekly recap. Stale links are re-checked now,
 * so a link opened or removed since the recap no longer shows up.
 */
export const GET = withApiHandler(async () => {
  const { userId } = await requireAuth();
  const recap = await prisma.weeklyRecap.findFirst({
    where: { userId },
    orderBy: { weekStart: "desc" },
  });
  if (!recap) return NextResponse.json({ recap: null });

  const archivedChangeSet = recap.archivedChangeSetId
    ? await prisma.changeSet.findFirst({
        where: { id: recap.archivedChangeSetId, userId },
        select: { id: true, revertedAt: true },
      })
    : null;
  const archived = archivedChangeSet && !archivedChangeSet.revertedAt;

  const staleItems = archived
    ? []
    : await prisma.canvasItem.findMany({
        where: {
          id: { in: recap.staleItemIds },
          ...staleLinkWhere(userId, staleCutoff(new Date(), recap.staleWeeks)),
        },
        select: {
          id: true,
          content: true,
          updatedAt: true,
          lastOpenedAt: true,
          canvas: { select: { id: true, name: true } },
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      });

  const staleLinks = staleItems.flatMap((item) => {
    const link = describeLink(item);
    if (!link) return [];
    const content = item.content as Record<string, unknown>;
    return [
      {
        ...link,
        summary: typeof content.summary === "string" ? content.summary : null,
        board: item.canvas,
        lastTouchedAt: (item.lastOpenedAt && item.lastOpenedAt > item.updatedAt
          ? item.lastOpenedAt
          : item.updatedAt
        ).toISOString(),
      },
    ];
  });

  return NextResponse.json({
    recap: {
      id: recap.id,
      weekStart: recap.weekStart.toISOString(),
      periodStart: recap.periodStart.toISOString(),
      periodEnd: recap.periodEnd.toISOString(),
      savedCount: recap.savedCount,
      savedLinks: parseRecapSavedLinks(recap.savedLinks),
      suggestedPiles: parseRecapPiles(recap.suggestedPiles).map((pile) => ({
        title: pile.title,
        itemCount: pile.itemIds.length,
      })),
      staleWeeks: recap.staleWeeks,
      staleCount: recap.staleCount,
      staleLinks,
      archived: archived
        ? {
            changeSetId: archivedChangeSet.id,
            archivedAt: recap.archivedAt?.toISOString() ?? null,
          }
        : null,
    },
  });
});
