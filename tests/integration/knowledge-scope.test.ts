import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));

import { prisma } from "@/lib/db";
import { listScopedKnowledgeEntities } from "@/lib/agents/query-core";

afterAll(async () => {
  await prisma.$disconnect();
});

async function seed() {
  const user = await prisma.user.create({
    data: { email: `knowledge-${randomBytes(6).toString("hex")}@example.com` },
  });
  const [canvasA, canvasB] = await Promise.all(
    ["A", "B"].map((name) =>
      prisma.canvas.create({ data: { name, userId: user.id } }),
    ),
  );
  const item = (canvasId: string) =>
    prisma.canvasItem.create({
      data: {
        canvasId,
        type: "TEXT",
        positionX: 0,
        positionY: 0,
        width: 100,
        height: 100,
        content: { text: "note" },
        createdById: user.id,
      },
    });
  const itemA1 = await item(canvasA!.id);
  const itemA2 = await item(canvasA!.id);
  const itemB1 = await item(canvasB!.id);
  const itemB2 = await item(canvasB!.id);

  const entity = (title: string, itemIds: string[]) =>
    prisma.knowledgeEntity.create({
      data: {
        userId: user.id,
        entityType: "topic",
        title,
        itemLinks: { create: itemIds.map((itemId) => ({ itemId })) },
      },
    });
  // X sits on A and also on B; Y's only source item has moved to B; Z is on A.
  const x = await entity("Visible X", [itemA1.id, itemB2.id]);
  const y = await entity("Secret Y", [itemB1.id]);
  const z = await entity("Visible Z", [itemA2.id]);
  const relation = (
    sourceEntityId: string,
    targetEntityId: string,
    relationType: string,
  ) =>
    prisma.knowledgeRelation.create({
      data: { userId: user.id, sourceEntityId, targetEntityId, relationType },
    });
  await relation(x.id, y.id, "mentions");
  await relation(y.id, x.id, "cites");
  await relation(x.id, z.id, "related");
  await relation(z.id, x.id, "follows");

  const agentActor = {
    userId: user.id,
    agentProfile: {
      id: "agent-profile",
      userId: user.id,
      name: "Scoped agent",
      status: "ACTIVE" as const,
      maxCapabilityRung: 1,
      enabledRungs: [0, 1],
      allowedCanvasIds: [canvasA!.id],
      defaultModelCredentialId: null,
    },
  };
  return {
    user,
    canvasA: canvasA!,
    itemA1,
    itemB2,
    x,
    y,
    z,
    agentActor,
    userActor: { userId: user.id, agentProfile: null },
  };
}

type Listed = Awaited<ReturnType<typeof listScopedKnowledgeEntities>>;

function relatedTitles(result: Listed, entityId: string) {
  const entity = result.entities.find((row) => row.id === entityId)!;
  return [
    ...entity.outgoingRelations.map((row) => row.targetEntity.title),
    ...entity.incomingRelations.map((row) => row.sourceEntity.title),
  ].sort();
}

describe("listScopedKnowledgeEntities agent scope", () => {
  it("omits relations and item links outside the agent's canvases (canvas branch)", async () => {
    const fixture = await seed();
    const result = await listScopedKnowledgeEntities(fixture.agentActor, {
      canvasId: fixture.canvasA.id,
    });

    expect(JSON.stringify(result)).not.toContain("Secret Y");
    expect(relatedTitles(result, fixture.x.id)).toEqual([
      "Visible Z",
      "Visible Z",
    ]);
    const x = result.entities.find((row) => row.id === fixture.x.id)!;
    expect(x.itemLinks.map((link) => link.itemId)).toEqual([fixture.itemA1.id]);
  });

  it("omits out-of-scope related entities in the item branch", async () => {
    const fixture = await seed();
    const result = await listScopedKnowledgeEntities(fixture.agentActor, {
      itemId: fixture.itemA1.id,
    });

    expect(JSON.stringify(result)).not.toContain("Secret Y");
    expect(relatedTitles(result, fixture.x.id)).toEqual([
      "Visible Z",
      "Visible Z",
    ]);
  });

  it("returns everything to a user session", async () => {
    const fixture = await seed();
    const byCanvas = await listScopedKnowledgeEntities(fixture.userActor, {
      canvasId: fixture.canvasA.id,
    });
    expect(relatedTitles(byCanvas, fixture.x.id)).toEqual([
      "Secret Y",
      "Secret Y",
      "Visible Z",
      "Visible Z",
    ]);
    const x = byCanvas.entities.find((row) => row.id === fixture.x.id)!;
    expect(x.itemLinks).toHaveLength(2);

    const byItem = await listScopedKnowledgeEntities(fixture.userActor, {
      itemId: fixture.itemA1.id,
    });
    expect(relatedTitles(byItem, fixture.x.id)).toHaveLength(4);
  });
});
