import { prisma } from "@/lib/db";
import { assertCanvasScope } from "@/lib/agents/policy";
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
      include: {
        itemLinks: true,
        outgoingRelations: {
          include: {
            sourceEntity: {
              select: {
                id: true,
                entityType: true,
                title: true,
                status: true,
              },
            },
            targetEntity: {
              select: {
                id: true,
                entityType: true,
                title: true,
                status: true,
              },
            },
          },
          orderBy: [{ relationType: "asc" }, { createdAt: "asc" }],
        },
        incomingRelations: {
          include: {
            sourceEntity: {
              select: {
                id: true,
                entityType: true,
                title: true,
                status: true,
              },
            },
            targetEntity: {
              select: {
                id: true,
                entityType: true,
                title: true,
                status: true,
              },
            },
          },
          orderBy: [{ relationType: "asc" }, { createdAt: "asc" }],
        },
      },
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
    include: {
      itemLinks: {
        where: {
          itemId: item.id,
        },
      },
      outgoingRelations: {
        include: {
          sourceEntity: {
            select: {
              id: true,
              entityType: true,
              title: true,
              status: true,
            },
          },
          targetEntity: {
            select: {
              id: true,
              entityType: true,
              title: true,
              status: true,
            },
          },
        },
        orderBy: [{ relationType: "asc" }, { createdAt: "asc" }],
      },
      incomingRelations: {
        include: {
          sourceEntity: {
            select: {
              id: true,
              entityType: true,
              title: true,
              status: true,
            },
          },
          targetEntity: {
            select: {
              id: true,
              entityType: true,
              title: true,
              status: true,
            },
          },
        },
        orderBy: [{ relationType: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  return { entities };
}

export async function listScopedActionTimeline(
  actor: ScopedActor,
  input: {
    limit: number;
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

  const [actions, changeSets, suggestions] = await Promise.all([
    prisma.agentAction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: input.limit,
    }),
    prisma.changeSet.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: input.limit,
      include: {
        changeRecords: true,
      },
    }),
    prisma.suggestion.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: input.limit,
    }),
  ]);

  return {
    actions,
    changeSets,
    suggestions,
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
