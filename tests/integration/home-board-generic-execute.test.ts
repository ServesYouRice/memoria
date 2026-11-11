/**
 * TASK-025 — a home-board Ask suggestion executed through the generic
 * execute-suggestion action is finalized like an Inbox accept.
 */

import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import type { AgentRequestContext } from "@/lib/agents/auth";

const contextState = vi.hoisted(() => ({
  current: null as AgentRequestContext | null,
}));

vi.mock("@/lib/agents/auth", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveAgentRequestContext: async () => contextState.current,
}));
vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));
vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));

import { prisma } from "@/lib/db";
import {
  createHomeBoardProposalHandler,
  undoHomeBoardMove,
} from "@/lib/agents/home-board";
import { POST as actionsPost } from "@/app/api/agent/v1/actions/route";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("generic execution of a home-board suggestion", () => {
  it("marks the home-board row ACCEPTED with the change set, so undo works", async () => {
    const user = await prisma.user.create({
      data: {
        email: `home-generic-${randomBytes(6).toString("hex")}@example.com`,
      },
    });
    const inbox = await prisma.canvas.create({
      data: { name: "Inbox", userId: user.id },
    });
    const rome = await prisma.canvas.create({
      data: { name: "Rome trip", userId: user.id },
    });
    await prisma.canvasItem.create({
      data: {
        canvasId: rome.id,
        type: "NOTE",
        positionX: 0,
        positionY: 0,
        width: 200,
        height: 200,
        content: { text: "Flights" },
        tags: ["travel", "rome"],
        createdById: user.id,
      },
    });
    const item = await prisma.canvasItem.create({
      data: {
        canvasId: inbox.id,
        type: "BOOKMARK",
        positionX: 80,
        positionY: 80,
        width: 360,
        height: 120,
        content: {
          url: "https://example.com/colosseum",
          title: "Colosseum tickets",
        },
        tags: ["rome", "travel"],
        createdById: user.id,
      },
    });
    await createHomeBoardProposalHandler(prisma, {
      aiAvailable: async () => false,
    })({ payload: { itemId: item.id } } as never);
    const row = await prisma.homeBoardSuggestion.findUniqueOrThrow({
      where: { itemId: item.id },
    });
    expect(row.targetCanvasId).toBe(rome.id);
    // The owner approves it in the Agent Control Center, then executes it.
    await prisma.suggestion.update({
      where: { id: row.suggestionId! },
      data: { status: "APPROVED" },
    });

    contextState.current = {
      actorType: "user",
      userId: user.id,
      agentProfile: null,
      integrationAccountId: null,
    };
    const response = await actionsPost(
      new NextRequest("http://localhost/api/agent/v1/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "execute-suggestion",
          suggestionId: row.suggestionId,
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(
      (await prisma.canvasItem.findUniqueOrThrow({ where: { id: item.id } }))
        .canvasId,
    ).toBe(rome.id);

    const finalized = await prisma.homeBoardSuggestion.findUniqueOrThrow({
      where: { itemId: item.id },
    });
    expect(finalized.status).toBe("ACCEPTED");
    expect(finalized.changeSetId).toBe(body.executed.changeSetId);
    expect(finalized.actedAt).not.toBeNull();

    await undoHomeBoardMove({ userId: user.id, itemId: item.id });
    expect(
      (await prisma.canvasItem.findUniqueOrThrow({ where: { id: item.id } }))
        .canvasId,
    ).toBe(inbox.id);
  });
});
