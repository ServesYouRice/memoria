/**
 * TASK-125 — MCP execution of an approved suggestion runs under the profile
 * that proposed it; another agent cannot execute (or strand) it.
 */

import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));
vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));

import { prisma } from "@/lib/db";
import { executeMcpTool } from "@/lib/agents/mcp";
import { ForbiddenError } from "@/lib/errors";

afterAll(async () => {
  await prisma.$disconnect();
});

async function setup() {
  const user = await prisma.user.create({
    data: { email: `mcp-exec-${randomBytes(6).toString("hex")}@example.com` },
  });
  const canvas = await prisma.canvas.create({
    data: { name: "Board", userId: user.id },
  });
  const [a, b] = await Promise.all(
    ["Agent A", "Agent B"].map((name) =>
      prisma.agentProfile.create({
        data: { userId: user.id, name, allowedCanvasIds: [canvas.id] },
      }),
    ),
  );
  const suggestion = await prisma.suggestion.create({
    data: {
      userId: user.id,
      agentProfileId: a.id,
      kind: "INTERNAL_ORGANIZATION",
      status: "APPROVED",
      summary: "Add a note",
      payload: {
        kind: "canvas-item-create",
        canvasId: canvas.id,
        item: {
          type: "NOTE",
          positionX: 0,
          positionY: 0,
          width: 200,
          height: 200,
          zIndex: 0,
          content: { text: "hi" },
        },
      },
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return { user, a, b, suggestion };
}

function agentContext(userId: string, agentProfile: unknown) {
  return {
    actorType: "integration",
    userId,
    agentProfile,
    integrationAccountId: null,
  } as never;
}

describe("MCP actions.execute_suggestion profile binding", () => {
  it("refuses another agent before claiming and runs under the proposer", async () => {
    const { user, a, b, suggestion } = await setup();

    await expect(
      executeMcpTool(agentContext(user.id, b), "actions.execute_suggestion", {
        suggestionId: suggestion.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      (
        await prisma.suggestion.findUniqueOrThrow({
          where: { id: suggestion.id },
        })
      ).status,
    ).toBe("APPROVED");
    expect(await prisma.changeSet.count({ where: { userId: user.id } })).toBe(
      0,
    );

    await executeMcpTool(
      agentContext(user.id, a),
      "actions.execute_suggestion",
      {
        suggestionId: suggestion.id,
      },
    );
    const changeSets = await prisma.changeSet.findMany({
      where: { userId: user.id },
    });
    expect(changeSets.map((set) => set.agentProfileId)).toEqual([a.id]);
  });

  it("lets the owner's session execute under the proposer, not a named other profile", async () => {
    const { user, a, b, suggestion } = await setup();
    const owner = {
      actorType: "user",
      userId: user.id,
      agentProfile: null,
      integrationAccountId: null,
    } as never;

    await expect(
      executeMcpTool(owner, "actions.execute_suggestion", {
        suggestionId: suggestion.id,
        agentProfileId: b.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prisma.changeSet.count({ where: { userId: user.id } })).toBe(
      0,
    );

    await executeMcpTool(owner, "actions.execute_suggestion", {
      suggestionId: suggestion.id,
    });
    const changeSets = await prisma.changeSet.findMany({
      where: { userId: user.id },
    });
    expect(changeSets.map((set) => set.agentProfileId)).toEqual([a.id]);
  });
});
