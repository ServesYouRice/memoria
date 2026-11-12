import { loadItemLinks } from "@/lib/canvas/arrow-links";
import {
  ChangeSetStatus,
  Prisma,
  type SuggestionStatus,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { assertCanvasScope } from "@/lib/agents/policy";
import {
  getItemPlainText,
  getItemTitle,
  getItemUrl,
} from "@/lib/agents/item-text";
import type { AgentRequestContext } from "@/lib/agents/auth";
import { BadRequestError, ForbiddenError, NotFoundError } from "@/lib/errors";

type ScopedActor = Pick<AgentRequestContext, "userId" | "agentProfile">;

export async function requireScopedCanvas(
  actor: ScopedActor,
  canvasId: string,
) {
  const canvas = await prisma.canvas.findFirst({
    where: {
      id: canvasId,
      userId: actor.userId,
    },
    select: {
      id: true,
      name: true,
      updatedAt: true,
    },
  });

  if (!canvas) {
    throw new NotFoundError("Canvas not found.");
  }

  assertCanvasScope(actor.agentProfile, canvasId);
  return canvas;
}

export async function requireScopedItem(actor: ScopedActor, itemId: string) {
  const item = await prisma.canvasItem.findFirst({
    where: {
      id: itemId,
      deletedAt: null,
      canvas: {
        userId: actor.userId,
      },
    },
    select: {
      id: true,
      canvasId: true,
    },
  });

  if (!item) {
    throw new NotFoundError("Canvas item not found.");
  }

  assertCanvasScope(actor.agentProfile, item.canvasId);
  return item;
}

export async function requireScopedKnowledgeEntity(
  actor: ScopedActor,
  entityId: string,
) {
  const entity = await prisma.knowledgeEntity.findFirst({
    where: {
      id: entityId,
      userId: actor.userId,
    },
    select: {
      id: true,
      title: true,
      entityType: true,
      itemLinks: {
        select: {
          item: {
            select: {
              canvasId: true,
            },
          },
        },
      },
    },
  });

  if (!entity) {
    throw new NotFoundError("Knowledge entity not found.");
  }

  const canvasIds = Array.from(
    new Set(entity.itemLinks.map((link) => link.item.canvasId)),
  );

  if (canvasIds.length === 0) {
    throw new BadRequestError(
      "Knowledge entity has no source item scope and cannot be mutated.",
    );
  }

  const scopedCanvasIds = actor.agentProfile
    ? canvasIds.filter((canvasId) =>
        actor.agentProfile?.allowedCanvasIds.includes(canvasId),
      )
    : canvasIds;

  if (scopedCanvasIds.length === 0) {
    throw new ForbiddenError(
      "This knowledge entity is outside the current agent scope.",
    );
  }

  return {
    id: entity.id,
    title: entity.title,
    entityType: entity.entityType,
    canvasIds,
    scopedCanvasId: scopedCanvasIds[0],
  };
}

export async function listScopedCanvases(
  actor: ScopedActor,
  input: {
    limit: number;
    offset: number;
  },
) {
  const where = actor.agentProfile
    ? {
        userId: actor.userId,
        id: {
          in: actor.agentProfile.allowedCanvasIds,
        },
      }
    : {
        userId: actor.userId,
      };

  const canvases = await prisma.canvas.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: input.limit,
    skip: input.offset,
  });

  return {
    canvases,
    pagination: {
      limit: input.limit,
      offset: input.offset,
      hasMore: canvases.length === input.limit,
    },
  };
}

export async function listScopedCanvasItems(
  actor: ScopedActor,
  canvasId: string,
) {
  await requireScopedCanvas(actor, canvasId);

  return prisma.canvasItem.findMany({
    where: {
      canvasId,
      deletedAt: null,
    },
    orderBy: [{ zIndex: "asc" }, { createdAt: "asc" }],
  });
}

const MAX_SEARCH_TERMS = 8;

/**
 * Word search across the boards an agent may read. Every term must appear in
 * the item's text, title, link or tags; newest matches come first.
 */
export async function searchScopedItems(
  actor: ScopedActor,
  input: { query: string; canvasId?: string; limit: number },
) {
  const terms = input.query
    .trim()
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .slice(0, MAX_SEARCH_TERMS);

  if (terms.length === 0) {
    throw new BadRequestError("Search query cannot be empty.");
  }

  if (input.canvasId) {
    await requireScopedCanvas(actor, input.canvasId);
  }

  const canvasFilter = input.canvasId
    ? Prisma.sql`AND i."canvasId" = ${input.canvasId}`
    : actor.agentProfile
      ? Prisma.sql`AND i."canvasId" = ANY(${actor.agentProfile.allowedCanvasIds}::text[])`
      : Prisma.empty;
  const haystack = Prisma.sql`concat_ws(' ',
    i."content"->>'plainText', i."content"->>'text', i."content"->>'title',
    i."content"->>'description', i."content"->>'url', i."content"->>'alt',
    array_to_string(i."tags", ' '))`;
  const termFilters = terms.map((term) => {
    const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
    return Prisma.sql`AND ${haystack} ILIKE ${pattern} ESCAPE '\\'`;
  });

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      canvasId: string;
      canvasName: string;
      type: string;
      content: unknown;
      tags: string[];
      updatedAt: Date;
    }>
  >`
    SELECT i."id", i."canvasId", c."name" AS "canvasName", i."type"::text AS "type",
      i."content", i."tags", i."updatedAt"
    FROM "CanvasItem" i
    JOIN "Canvas" c ON c."id" = i."canvasId"
    WHERE c."userId" = ${actor.userId}
      AND i."deletedAt" IS NULL
      ${canvasFilter}
      ${Prisma.join(termFilters, " ")}
    ORDER BY i."updatedAt" DESC
    LIMIT ${input.limit}
  `;

  return {
    results: rows.map((row) => ({
      itemId: row.id,
      canvasId: row.canvasId,
      canvasName: row.canvasName,
      type: row.type,
      title: getItemTitle(row),
      url: getItemUrl(row),
      snippet: getItemPlainText(row).slice(0, 280),
      tags: row.tags,
      updatedAt: row.updatedAt,
    })),
  };
}

/** One item with its readable text, for agents that need the full content. */
export async function getScopedItemDetail(actor: ScopedActor, itemId: string) {
  const scoped = await requireScopedItem(actor, itemId);
  const item = await prisma.canvasItem.findUniqueOrThrow({
    where: { id: scoped.id },
    select: {
      id: true,
      canvasId: true,
      type: true,
      content: true,
      tags: true,
      positionX: true,
      positionY: true,
      width: true,
      height: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // Links share the item's canvas, so they are in the same scope (IMP-095).
  const links = await loadItemLinks(prisma, [item.id], AGENT_ITEM_LINKS);

  return {
    item: {
      ...item,
      title: getItemTitle(item),
      url: getItemUrl(item),
      text: getItemPlainText(item),
      links: links.get(item.id) ?? [],
    },
  };
}

const AGENT_ITEM_LINKS = 25;

const KNOWLEDGE_ENDPOINT_SELECT = {
  id: true,
  entityType: true,
  title: true,
  status: true,
} as const;

/**
 * Relation and item-link includes for a knowledge listing. For an agent, a
 * related entity is shown only when one of its item links is on a canvas in
 * agentProfile.allowedCanvasIds, and item links are limited to those canvases:
 * items can move between boards after a relation was created.
 */
function knowledgeListInclude(
  actor: ScopedActor,
  itemLinksWhere?: Prisma.ItemEntityLinkWhereInput,
) {
  const allowedCanvasIds = actor.agentProfile?.allowedCanvasIds;
  const inScopeEntity: Prisma.KnowledgeEntityWhereInput | undefined =
    allowedCanvasIds
      ? {
          itemLinks: {
            some: { item: { canvasId: { in: allowedCanvasIds } } },
          },
        }
      : undefined;
  const linkWhere: Prisma.ItemEntityLinkWhereInput = {
    ...itemLinksWhere,
    ...(allowedCanvasIds
      ? { item: { canvasId: { in: allowedCanvasIds } } }
      : {}),
  };
  const relationInclude = {
    sourceEntity: { select: KNOWLEDGE_ENDPOINT_SELECT },
    targetEntity: { select: KNOWLEDGE_ENDPOINT_SELECT },
  };
  const relationOrder: Prisma.KnowledgeRelationOrderByWithRelationInput[] = [
    { relationType: "asc" },
    { createdAt: "asc" },
  ];

  return {
    itemLinks: Object.keys(linkWhere).length > 0 ? { where: linkWhere } : true,
    outgoingRelations: {
      ...(inScopeEntity ? { where: { targetEntity: inScopeEntity } } : {}),
      include: relationInclude,
      orderBy: relationOrder,
    },
    incomingRelations: {
      ...(inScopeEntity ? { where: { sourceEntity: inScopeEntity } } : {}),
      include: relationInclude,
      orderBy: relationOrder,
    },
  } satisfies Prisma.KnowledgeEntityInclude;
}

export async function listScopedKnowledgeEntities(
  actor: ScopedActor,
  input: {
    canvasId?: string | null;
    itemId?: string | null;
  },
) {
  if (input.canvasId) {
    await requireScopedCanvas(actor, input.canvasId);

    const entities = await prisma.knowledgeEntity.findMany({
      where: {
        userId: actor.userId,
        itemLinks: {
          some: {
            item: {
              canvasId: input.canvasId,
            },
          },
        },
      },
      include: knowledgeListInclude(actor),
      orderBy: { updatedAt: "desc" },
    });

    return { entities };
  }

  if (!input.itemId) {
    throw new NotFoundError("Either canvasId or itemId is required.");
  }

  const item = await requireScopedItem(actor, input.itemId);
  const entities = await prisma.knowledgeEntity.findMany({
    where: {
      userId: actor.userId,
      itemLinks: {
        some: {
          itemId: item.id,
        },
      },
    },
    include: knowledgeListInclude(actor, { itemId: item.id }),
  });

  return { entities };
}

function readPayloadString(payload: Prisma.JsonValue, key: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return null;
  const value = (payload as Record<string, Prisma.JsonValue>)[key];
  return typeof value === "string" ? value : null;
}

/**
 * Keeps an agent's suggestions to canvases in its current scope: the canvas
 * comes from `payload.canvasId` or the canvas of `payload.itemId`. A
 * suggestion whose canvas cannot be determined is left out.
 */
async function filterSuggestionsToScope<
  T extends { payload: Prisma.JsonValue },
>(userId: string, allowedCanvasIds: Set<string>, suggestions: T[]) {
  const itemIds = [
    ...new Set(
      suggestions
        .map((suggestion) => readPayloadString(suggestion.payload, "itemId"))
        .filter((id): id is string => id !== null),
    ),
  ];
  const items = itemIds.length
    ? await prisma.canvasItem.findMany({
        where: { id: { in: itemIds }, canvas: { userId } },
        select: { id: true, canvasId: true },
      })
    : [];
  const itemCanvas = new Map(items.map((item) => [item.id, item.canvasId]));
  return suggestions.filter((suggestion) => {
    const canvasId = readPayloadString(suggestion.payload, "canvasId");
    const itemId = readPayloadString(suggestion.payload, "itemId");
    const itemCanvasId = itemId ? itemCanvas.get(itemId) : undefined;
    if (canvasId && !allowedCanvasIds.has(canvasId)) return false;
    if (itemId && (!itemCanvasId || !allowedCanvasIds.has(itemCanvasId)))
      return false;
    return Boolean(canvasId || itemCanvasId);
  });
}

/**
 * Ids of the newest suggestions that belong to one canvas: `payload.canvasId`
 * names it, or `payload.itemId` is one of its items.
 */
async function findCanvasSuggestionIds(
  where: { userId: string; agentProfileId?: string },
  canvasId: string,
  take: number,
  filter: {
    statuses?: SuggestionStatus[];
    before?: { createdAt: Date; id: string } | null;
  } = {},
) {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT s."id" FROM "Suggestion" s
    WHERE s."userId" = ${where.userId}
      ${
        where.agentProfileId
          ? Prisma.sql`AND s."agentProfileId" = ${where.agentProfileId}`
          : Prisma.empty
      }
      ${
        filter.statuses?.length
          ? Prisma.sql`AND s."status"::text IN (${Prisma.join(filter.statuses)})`
          : Prisma.empty
      }
      ${
        filter.before
          ? Prisma.sql`AND (s."createdAt" < ${filter.before.createdAt}
              OR (s."createdAt" = ${filter.before.createdAt}
                AND s."id" < ${filter.before.id}))`
          : Prisma.empty
      }
      AND (
        s."payload"->>'canvasId' = ${canvasId}
        OR s."payload"->>'itemId' IN (
          SELECT i."id" FROM "CanvasItem" i WHERE i."canvasId" = ${canvasId}
        )
      )
    ORDER BY s."createdAt" DESC, s."id" DESC
    LIMIT ${take}
  `;
  return rows.map((row) => row.id);
}

export async function listScopedActionTimeline(
  actor: ScopedActor,
  input: {
    limit: number;
    /** Restrict change sets and suggestions to one canvas, in the query. */
    canvasId?: string;
    /** Keep only suggestions in these statuses, in the query. */
    suggestionStatuses?: SuggestionStatus[];
    /** Keep only change sets that can still be reverted, in the query. */
    revertableOnly?: boolean;
    /** Id of the last suggestion of the previous page. */
    suggestionCursor?: string;
    /** Id of the last change set of the previous page. */
    changeSetCursor?: string;
  },
) {
  const where = actor.agentProfile
    ? {
        userId: actor.userId,
        agentProfileId: actor.agentProfile.id,
      }
    : {
        userId: actor.userId,
      };
  // An agent sees history only for canvases in its current scope (the same
  // rule assertCanvasScope applies); a user session sees everything it owns.
  const allowedCanvasIds = actor.agentProfile
    ? new Set(actor.agentProfile.allowedCanvasIds)
    : null;
  const { canvasId, suggestionCursor, changeSetCursor } = input;
  if (canvasId) assertCanvasScope(actor.agentProfile, canvasId);
  const suggestionStatuses = input.suggestionStatuses?.length
    ? input.suggestionStatuses
    : undefined;
  // A plain request keeps its old shape; any filter or cursor adds paging.
  const paged = Boolean(
    canvasId ||
    suggestionStatuses ||
    input.revertableOnly ||
    suggestionCursor ||
    changeSetCursor,
  );
  // One extra row tells a paging caller whether more exist.
  const take = paged ? input.limit + 1 : input.limit;
  const changeSetScope = canvasId
    ? { scopeType: "canvas", scopeId: canvasId }
    : allowedCanvasIds
      ? { scopeType: "canvas", scopeId: { in: [...allowedCanvasIds] } }
      : {};

  // A cursor names the last row of the previous page; rows after it in
  // (time desc, id desc) order follow. An unknown cursor is a bad request.
  const [suggestionBefore, changeSetBefore] = await Promise.all([
    suggestionCursor
      ? prisma.suggestion.findFirst({
          where: { ...where, id: suggestionCursor },
          select: { id: true, createdAt: true },
        })
      : null,
    changeSetCursor
      ? prisma.changeSet.findFirst({
          where: { ...where, id: changeSetCursor },
          select: { id: true, startedAt: true },
        })
      : null,
  ]);
  if (
    (suggestionCursor && !suggestionBefore) ||
    (changeSetCursor && !changeSetBefore)
  ) {
    throw new BadRequestError("Unknown timeline cursor.");
  }

  const [actions, changeSetRows, suggestionRows] = await Promise.all([
    prisma.agentAction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: input.limit,
    }),
    prisma.changeSet.findMany({
      where: {
        ...where,
        ...changeSetScope,
        // revertChangeSet refuses a change set that was already reverted; one
        // that never completed has nothing sound to undo.
        ...(input.revertableOnly
          ? { status: ChangeSetStatus.COMPLETED, revertedAt: null }
          : {}),
        ...(changeSetBefore
          ? {
              OR: [
                { startedAt: { lt: changeSetBefore.startedAt } },
                {
                  startedAt: changeSetBefore.startedAt,
                  id: { lt: changeSetBefore.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take,
      // Metadata only: the before/after snapshots hold whole serialized items
      // (one per item in a bulk write) and the timeline never shows them.
      // revertChangeSet loads the full records itself.
      include: {
        changeRecords: {
          select: {
            id: true,
            changeSetId: true,
            targetType: true,
            targetId: true,
            operation: true,
            reversible: true,
            revertedAt: true,
            createdAt: true,
          },
        },
        _count: { select: { changeRecords: true } },
      },
    }),
    canvasId
      ? findCanvasSuggestionIds(where, canvasId, take, {
          statuses: suggestionStatuses,
          before: suggestionBefore,
        }).then((ids) =>
          prisma.suggestion.findMany({
            where: { id: { in: ids } },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          }),
        )
      : prisma.suggestion.findMany({
          where: {
            ...where,
            ...(suggestionStatuses
              ? { status: { in: suggestionStatuses } }
              : {}),
            ...(suggestionBefore
              ? {
                  OR: [
                    { createdAt: { lt: suggestionBefore.createdAt } },
                    {
                      createdAt: suggestionBefore.createdAt,
                      id: { lt: suggestionBefore.id },
                    },
                  ],
                }
              : {}),
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take,
        }),
  ]);
  const changeSetsHasMore = changeSetRows.length > input.limit;
  const suggestionsHasMore = suggestionRows.length > input.limit;
  const changeSets = changeSetRows.slice(0, input.limit);
  const scopedSuggestions = suggestionRows.slice(0, input.limit);
  const suggestions = allowedCanvasIds
    ? await filterSuggestionsToScope(
        actor.userId,
        allowedCanvasIds,
        scopedSuggestions,
      )
    : scopedSuggestions;

  const timeline = {
    actions,
    changeSets: changeSets.map(({ _count, ...changeSet }) => ({
      ...changeSet,
      changeRecordCount: _count.changeRecords,
    })),
    suggestions,
  };
  if (!paged) return timeline;
  return {
    ...timeline,
    hasMore: changeSetsHasMore || suggestionsHasMore,
    suggestionsHasMore,
    changeSetsHasMore,
    // The cursor is the last row read, even when the scope filter dropped it.
    nextSuggestionCursor: suggestionsHasMore
      ? (scopedSuggestions.at(-1)?.id ?? null)
      : null,
    nextChangeSetCursor: changeSetsHasMore
      ? (changeSets.at(-1)?.id ?? null)
      : null,
  };
}

export async function listOwnedIntegrationAccounts(userId: string) {
  return prisma.integrationAccount.findMany({
    where: {
      agentProfile: {
        userId,
      },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      agentProfileId: true,
      providerType: true,
      externalAccountId: true,
      authMode: true,
      status: true,
      lastSeenAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function listOwnedProviderCredentials(userId: string) {
  return prisma.modelCredential.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      provider: true,
      label: true,
      baseUrl: true,
      defaultModel: true,
      capabilities: true,
      dailySpendCap: true,
      monthlySpendCap: true,
      status: true,
      lastVerifiedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}
