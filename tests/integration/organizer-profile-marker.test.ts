/**
 * TASK-123 — the built-in organizer is found by its system marker, never by
 * name, and gains a canvas only after its PROPOSE check passes.
 */
import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/api/auth", () => ({
  requireAuth: async () => ({ userId: auth.userId, email: "u@example.com" }),
}));
vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));

import { prisma } from "@/lib/db";
import { ORGANIZER_PROFILE_NAME } from "@/lib/agents/piles";
import { POST } from "@/app/api/v1/canvases/[canvasId]/organize/route";
import { POST as createProfile } from "@/app/api/v1/agent-profiles/route";
import { PATCH as updateProfile } from "@/app/api/v1/agent-profiles/[agentProfileId]/route";

afterAll(async () => {
  await prisma.$disconnect();
});

async function board(userId: string, name: string) {
  const canvas = await prisma.canvas.create({ data: { name, userId } });
  await prisma.canvasItem.createMany({
    data: ["pasta recipe", "pasta dinner", "hiking trail", "hiking boots"].map(
      (text, i) => ({
        canvasId: canvas.id,
        type: "NOTE" as const,
        positionX: i * 300,
        positionY: 0,
        width: 200,
        height: 200,
        content: { text, plainText: text },
        createdById: userId,
      }),
    ),
  });
  return canvas;
}

async function sort(canvasId: string) {
  return POST(
    new NextRequest(`http://localhost/api/v1/canvases/${canvasId}/organize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction: "" }),
    }),
    { params: Promise.resolve({ canvasId }) },
  );
}

async function newUser() {
  const user = await prisma.user.create({
    data: { email: `organizer-${randomBytes(6).toString("hex")}@example.com` },
  });
  auth.userId = user.id;
  return user;
}

describe("built-in organizer profile (TASK-123)", () => {
  it("never reuses a user profile that carries the organizer's name", async () => {
    const user = await newUser();
    const canvas = await board(user.id, "Recipes");
    // An integration profile the user happened to name like the organizer.
    const lookalike = await prisma.agentProfile.create({
      data: {
        userId: user.id,
        name: ORGANIZER_PROFILE_NAME,
        maxCapabilityRung: 3,
        enabledRungs: [0, 3],
        allowedCanvasIds: [],
      },
    });

    const response = await sort(canvas.id);
    expect(response.status).toBe(201);
    const { suggestionId } = await response.json();

    expect(
      (
        await prisma.agentProfile.findUniqueOrThrow({
          where: { id: lookalike.id },
        })
      ).allowedCanvasIds,
    ).toEqual([]);
    const suggestion = await prisma.suggestion.findUniqueOrThrow({
      where: { id: suggestionId },
    });
    expect(suggestion.agentProfileId).not.toBe(lookalike.id);
    const organizer = await prisma.agentProfile.findUniqueOrThrow({
      where: { id: suggestion.agentProfileId! },
    });
    expect(organizer).toMatchObject({
      systemKey: "organizer",
      name: ORGANIZER_PROFILE_NAME,
      allowedCanvasIds: [canvas.id],
    });

    // A second sort reuses the marked organizer.
    const again = await sort(canvas.id);
    expect(again.status).toBe(201);
    expect(
      await prisma.agentProfile.count({
        where: { userId: user.id, systemKey: "organizer" },
      }),
    ).toBe(1);
  });

  it("grants no canvas to an organizer that may not propose", async () => {
    const user = await newUser();
    const first = await board(user.id, "First");
    const second = await board(user.id, "Second");
    const { suggestionId } = await (await sort(first.id)).json();
    const organizerId = (
      await prisma.suggestion.findUniqueOrThrow({ where: { id: suggestionId } })
    ).agentProfileId!;
    await prisma.agentProfile.update({
      where: { id: organizerId },
      data: { enabledRungs: [0] },
    });

    const denied = await sort(second.id);
    expect(denied.status).toBe(403);
    expect(
      (
        await prisma.agentProfile.findUniqueOrThrow({
          where: { id: organizerId },
        })
      ).allowedCanvasIds,
    ).toEqual([first.id]);

    await prisma.agentProfile.update({
      where: { id: organizerId },
      data: { status: "DISABLED", enabledRungs: [0, 3] },
    });
    expect((await sort(second.id)).status).toBe(403);
    expect(
      (
        await prisma.agentProfile.findUniqueOrThrow({
          where: { id: organizerId },
        })
      ).allowedCanvasIds,
    ).toEqual([first.id]);
  });

  it("cannot be claimed through the agent profile API", async () => {
    const user = await newUser();
    const json = (method: string, body: unknown) =>
      new NextRequest("http://localhost/api/v1/agent-profiles", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const created = await createProfile(
      json("POST", { name: ORGANIZER_PROFILE_NAME, systemKey: "organizer" }),
    );
    expect(created.status).toBe(201);
    const { agentProfile } = await created.json();
    const patched = await updateProfile(
      json("PATCH", { name: ORGANIZER_PROFILE_NAME, systemKey: "organizer" }),
      { params: Promise.resolve({ agentProfileId: agentProfile.id }) },
    );
    expect(patched.status).toBe(200);
    expect(
      await prisma.agentProfile.findMany({
        where: { userId: user.id },
        select: { systemKey: true },
      }),
    ).toEqual([{ systemKey: null }]);
  });
});
