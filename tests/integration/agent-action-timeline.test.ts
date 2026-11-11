/**
 * TASK-021 — the agent action timeline is gated on the READ rung and the
 * profile's current canvas scope.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import type { AgentRequestContext } from "@/lib/agents/auth";

const contextState = vi.hoisted(() => ({
  current: null as AgentRequestContext | null,
}));

vi.mock("@/lib/agents/auth", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveAgentRequestContext: async () => contextState.current,
}));
vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));

import { prisma } from "@/lib/db";
import { listScopedActionTimeline } from "@/lib/agents/query-core";
import { GET as actionsGet } from "@/app/api/agent/v1/actions/route";

async function setup() {
  const owner = await prisma.user.create({
    data: { email: `timeline-${Date.now()}-${Math.random()}@example.com` },
  });
  const [inScope, descoped] = await Promise.all(
    ["In scope", "De-scoped"].map((name) =>
      prisma.canvas.create({ data: { name, userId: owner.id } }),
    ),
  );
  const items = await Promise.all(
    [inScope, descoped].map((canvas) =>
      prisma.canvasItem.create({
        data: {
          canvasId: canvas.id,
          type: "SHAPE",
          positionX: 0,
          positionY: 0,
          width: 10,
          height: 10,
          content: { shapeType: "star" },
          createdById: owner.id,
        },
      }),
    ),
  );
  const profile = await prisma.agentProfile.create({
    data: {
      userId: owner.id,
      name: "Agent",
      allowedCanvasIds: [inScope.id, descoped.id],
    },
  });
  for (const [index, canvas] of [inScope, descoped].entries()) {
    await prisma.changeSet.create({
      data: {
        userId: owner.id,
        agentProfileId: profile.id,
        scopeType: "canvas",
        scopeId: canvas.id,
        status: "COMPLETED",
        summary: `change ${canvas.name}`,
        changeRecords: {
          create: {
            targetType: "canvas_item",
            targetId: items[index].id,
            operation: "update",
            before: { secret: `before-${canvas.name}` },
            after: { secret: `after-${canvas.name}` },
          },
        },
      },
    });
    await prisma.suggestion.create({
      data: {
        userId: owner.id,
        agentProfileId: profile.id,
        kind: "INTERNAL_ORGANIZATION",
        summary: `canvas suggestion ${canvas.name}`,
        payload: { canvasId: canvas.id },
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.suggestion.create({
      data: {
        userId: owner.id,
        agentProfileId: profile.id,
        kind: "INTERNAL_ORGANIZATION",
        summary: `item suggestion ${canvas.name}`,
        payload: { itemId: items[index].id },
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
  }
  // The owner removes the second canvas from the profile's scope.
  const descopedProfile = await prisma.agentProfile.update({
    where: { id: profile.id },
    data: { allowedCanvasIds: [inScope.id] },
  });
  return { owner, inScope, descoped, profile: descopedProfile };
}

function agentContext(
  userId: string,
  agentProfile: AgentRequestContext["agentProfile"],
): AgentRequestContext {
  return {
    actorType: "integration",
    userId,
    agentProfile,
    integrationAccountId: null,
  };
}

beforeEach(async () => {
  await prisma.canvas.deleteMany({
    where: { user: { email: { startsWith: "timeline-" } } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: "timeline-" } },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("agent action timeline scope", () => {
  it("omits suggestions and change records of a de-scoped canvas", async () => {
    const { owner, inScope, profile } = await setup();
    const timeline = await listScopedActionTimeline(
      agentContext(owner.id, profile),
      { limit: 50 },
    );
    const serialized = JSON.stringify(timeline);
    expect(serialized).not.toContain("De-scoped");
    expect(timeline.changeSets).toHaveLength(1);
    expect(timeline.changeSets[0].scopeId).toBe(inScope.id);
    // The in-scope change record is listed as metadata only: TASK-141 keeps
    // the before/after snapshots out of the timeline.
    expect(timeline.changeSets[0].changeRecords).toHaveLength(1);
    expect(timeline.changeSets[0].changeRecordCount).toBe(1);
    expect(timeline.changeSets[0].changeRecords[0]).toMatchObject({
      targetType: "canvas_item",
      operation: "update",
    });
    expect(timeline.changeSets[0].changeRecords[0]).not.toHaveProperty(
      "before",
    );
    expect(timeline.suggestions.map((s) => s.summary).sort()).toEqual([
      "canvas suggestion In scope",
      "item suggestion In scope",
    ]);
  });

  it("keeps the owner's full timeline for a user session", async () => {
    const { owner } = await setup();
    const timeline = await listScopedActionTimeline(
      { userId: owner.id, agentProfile: null },
      { limit: 50 },
    );
    expect(timeline.changeSets).toHaveLength(2);
    expect(timeline.suggestions).toHaveLength(4);
  });

  it("refuses the GET route when the READ rung is disabled", async () => {
    const { owner, profile } = await setup();
    const noRead = await prisma.agentProfile.update({
      where: { id: profile.id },
      data: { enabledRungs: [1, 2, 3] },
    });
    contextState.current = agentContext(owner.id, noRead);
    const denied = await actionsGet(
      new NextRequest("http://localhost/api/agent/v1/actions"),
    );
    expect(denied.status).toBe(403);
    expect(JSON.stringify(await denied.json())).not.toContain("secret");

    contextState.current = {
      ...agentContext(owner.id, null),
      actorType: "user",
    };
    const allowed = await actionsGet(
      new NextRequest("http://localhost/api/agent/v1/actions"),
    );
    expect(allowed.status).toBe(200);
    const body = await allowed.json();
    expect(Object.keys(body).sort()).toEqual([
      "actions",
      "changeSets",
      "suggestions",
    ]);
    expect(body.changeSets).toHaveLength(2);
  });
});

describe("canvas-filtered timeline (TASK-022)", () => {
  it("returns this canvas's older records past 100 newer ones elsewhere", async () => {
    const { owner, inScope, descoped } = await setup();
    const old = new Date(Date.now() - 86_400_000);
    await prisma.changeSet.updateMany({
      where: { scopeId: inScope.id },
      data: { startedAt: old },
    });
    await prisma.suggestion.updateMany({
      where: { userId: owner.id, summary: { endsWith: "In scope" } },
      data: { createdAt: old },
    });
    const profileId = (
      await prisma.agentProfile.findFirstOrThrow({
        where: { userId: owner.id },
      })
    ).id;
    await prisma.changeSet.createMany({
      data: Array.from({ length: 105 }, (_, i) => ({
        userId: owner.id,
        agentProfileId: profileId,
        scopeType: "canvas",
        scopeId: descoped.id,
        status: "COMPLETED" as const,
        summary: `noise ${i}`,
      })),
    });
    await prisma.suggestion.createMany({
      data: Array.from({ length: 105 }, (_, i) => ({
        userId: owner.id,
        agentProfileId: profileId,
        kind: "INTERNAL_ORGANIZATION" as const,
        summary: `noise ${i}`,
        payload: { canvasId: descoped.id },
        expiresAt: new Date(Date.now() + 60_000),
      })),
    });

    contextState.current = {
      ...agentContext(owner.id, null),
      actorType: "user",
    };
    const response = await actionsGet(
      new NextRequest(
        `http://localhost/api/agent/v1/actions?limit=100&canvasId=${inScope.id}`,
      ),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.changeSets.map((c: { scopeId: string }) => c.scopeId)).toEqual([
      inScope.id,
    ]);
    expect(
      body.suggestions.map((s: { summary: string }) => s.summary).sort(),
    ).toEqual(["canvas suggestion In scope", "item suggestion In scope"]);
    expect(body.hasMore).toBe(false);

    const small = await (
      await actionsGet(
        new NextRequest(
          `http://localhost/api/agent/v1/actions?limit=1&canvasId=${inScope.id}`,
        ),
      )
    ).json();
    expect(small.suggestions).toHaveLength(1);
    expect(small.hasMore).toBe(true);

    // An agent token may not name a canvas outside its scope.
    const profile = await prisma.agentProfile.findFirstOrThrow({
      where: { id: profileId },
    });
    contextState.current = agentContext(owner.id, profile);
    const denied = await actionsGet(
      new NextRequest(
        `http://localhost/api/agent/v1/actions?canvasId=${descoped.id}`,
      ),
    );
    expect(denied.status).toBe(403);
  });
});

describe("timeline status, revertable and cursor filters (TASK-128)", () => {
  async function seedNoise() {
    const { owner, inScope, descoped } = await setup();
    const old = new Date(Date.now() - 86_400_000);
    // The four seeded suggestions stay OPEN and become the oldest rows; the
    // two seeded change sets stay revertable and become the oldest rows.
    await prisma.suggestion.updateMany({
      where: { userId: owner.id },
      data: { createdAt: old },
    });
    await prisma.changeSet.updateMany({
      where: { userId: owner.id },
      data: { startedAt: old },
    });
    const profileId = (
      await prisma.agentProfile.findFirstOrThrow({
        where: { userId: owner.id },
      })
    ).id;
    await prisma.suggestion.createMany({
      data: Array.from({ length: 15 }, (_, i) => ({
        userId: owner.id,
        agentProfileId: profileId,
        kind: "INTERNAL_ORGANIZATION" as const,
        status: i % 2 ? ("EXECUTED" as const) : ("REJECTED" as const),
        summary: `resolved ${i}`,
        payload: { canvasId: inScope.id },
        expiresAt: new Date(Date.now() + 60_000),
      })),
    });
    await prisma.changeSet.createMany({
      data: Array.from({ length: 15 }, (_, i) => ({
        userId: owner.id,
        agentProfileId: profileId,
        scopeType: "canvas",
        scopeId: inScope.id,
        status: i % 2 ? ("REVERTED" as const) : ("FAILED" as const),
        revertedAt: i % 2 ? new Date() : null,
        summary: `closed ${i}`,
      })),
    });
    contextState.current = {
      ...agentContext(owner.id, null),
      actorType: "user",
    };
    return { owner, inScope, descoped };
  }

  async function get(query: string) {
    const response = await actionsGet(
      new NextRequest(`http://localhost/api/agent/v1/actions?${query}`),
    );
    return { status: response.status, body: await response.json() };
  }

  it("returns older OPEN suggestions and revertable change sets past newer resolved ones", async () => {
    const { inScope } = await seedNoise();

    // The plain request is unchanged: newest rows of any status, old shape.
    const plain = await get("limit=12");
    expect(Object.keys(plain.body).sort()).toEqual([
      "actions",
      "changeSets",
      "suggestions",
    ]);
    expect(
      plain.body.suggestions.every((s: { status: string }) =>
        ["EXECUTED", "REJECTED"].includes(s.status),
      ),
    ).toBe(true);

    const filtered = await get(
      "limit=12&suggestionStatus=OPEN,APPROVED&revertable=true",
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.suggestions).toHaveLength(4);
    expect(
      filtered.body.suggestions.every(
        (s: { status: string }) => s.status === "OPEN",
      ),
    ).toBe(true);
    expect(filtered.body.changeSets).toHaveLength(2);
    expect(
      filtered.body.changeSets.every(
        (c: { status: string; revertedAt: string | null }) =>
          c.status === "COMPLETED" && c.revertedAt === null,
      ),
    ).toBe(true);
    expect(filtered.body).toMatchObject({
      suggestionsHasMore: false,
      changeSetsHasMore: false,
      nextSuggestionCursor: null,
      nextChangeSetCursor: null,
    });

    // Canvas and status together: only this canvas's open suggestions.
    const canvas = await get(
      `limit=12&canvasId=${inScope.id}&suggestionStatus=OPEN&revertable=true`,
    );
    expect(
      canvas.body.suggestions.map((s: { summary: string }) => s.summary).sort(),
    ).toEqual(["canvas suggestion In scope", "item suggestion In scope"]);
    expect(
      canvas.body.changeSets.map((c: { scopeId: string }) => c.scopeId),
    ).toEqual([inScope.id]);
  });

  it("pages each list with its cursor", async () => {
    await seedNoise();
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const { body } = await get(
        `limit=3&suggestionStatus=OPEN${cursor ? `&suggestionCursor=${cursor}` : ""}`,
      );
      seen.push(...body.suggestions.map((s: { id: string }) => s.id));
      cursor = body.nextSuggestionCursor;
      expect(body.suggestionsHasMore).toBe(cursor !== null);
      if (!cursor) break;
    }
    expect(seen).toHaveLength(4);
    expect(new Set(seen).size).toBe(4);

    const first = await get("limit=10");
    expect(first.body.changeSets).toHaveLength(10);
    const paged = await get(
      "limit=10&revertable=false&changeSetCursor=" +
        first.body.changeSets[9].id,
    );
    expect(paged.body.changeSets).toHaveLength(7);
    expect(paged.body.changeSetsHasMore).toBe(false);
    const ids = new Set([
      ...first.body.changeSets.map((c: { id: string }) => c.id),
      ...paged.body.changeSets.map((c: { id: string }) => c.id),
    ]);
    expect(ids.size).toBe(17);

    expect((await get("suggestionStatus=NOPE")).status).toBe(400);
    expect((await get("revertable=maybe")).status).toBe(400);
  });
});
