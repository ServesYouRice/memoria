import { prisma } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { getAskAssistantProfile } from "@/lib/ai/ask-commands";
import { archiveItems } from "@/lib/services/archive";
import { staleCutoff, staleLinkWhere } from "@/lib/recap/weekly-recap";

/**
 * IMP-070 "Archive these": archives the recap's stale links that are still
 * stale now (one opened or edited since the recap stays), as one change set
 * the user can undo. Archiving the same recap again is refused until that
 * change set is undone.
 */
export async function archiveRecapStaleLinks(input: {
  userId: string;
  recapId: string;
}) {
  const recap = await prisma.weeklyRecap.findFirst({
    where: { id: input.recapId, userId: input.userId },
    select: {
      id: true,
      staleItemIds: true,
      staleWeeks: true,
      archivedChangeSetId: true,
    },
  });
  if (!recap) throw new NotFoundError("Recap not found.");
  if (recap.archivedChangeSetId) {
    const previous = await prisma.changeSet.findFirst({
      where: { id: recap.archivedChangeSetId, userId: input.userId },
      select: { revertedAt: true },
    });
    if (previous && !previous.revertedAt) {
      throw new ConflictError("These links are already archived.");
    }
  }

  const stale = staleLinkWhere(
    input.userId,
    staleCutoff(new Date(), recap.staleWeeks),
  );
  const stillStale = await prisma.canvasItem.findMany({
    where: { id: { in: recap.staleItemIds }, ...stale },
    select: { id: true },
  });
  const profile = await getAskAssistantProfile(input.userId);
  const summary = (count: number) =>
    `Archive ${count} ${count === 1 ? "link" : "links"} not opened in ${recap.staleWeeks} weeks`;
  return archiveItems({
    actor: {
      userId: input.userId,
      agentProfileId: profile.id,
      modelCredentialId: profile.defaultModelCredentialId,
    },
    itemIds: stillStale.map((item) => item.id),
    summary: summary(stillStale.length),
    options: {
      // A link opened or edited since the read above stays on its board.
      eligibleWhere: stale,
      onArchived: async (tx, archived) => {
        // The undo link commits with the archive. Matching the value read
        // above lets only one of two concurrent requests through.
        const linked = await tx.weeklyRecap.updateMany({
          where: {
            id: recap.id,
            userId: input.userId,
            archivedChangeSetId: recap.archivedChangeSetId,
          },
          data: {
            archivedChangeSetId: archived.changeSetId,
            archivedAt: new Date(),
          },
        });
        if (linked.count === 0) {
          throw new ConflictError("These links are already archived.");
        }
        if (archived.itemIds.length !== stillStale.length) {
          const data = { summary: summary(archived.itemIds.length) };
          await tx.changeSet.update({
            where: { id: archived.changeSetId },
            data,
          });
          await tx.agentAction.update({
            where: { id: archived.agentActionId },
            data,
          });
        }
      },
    },
  });
}
