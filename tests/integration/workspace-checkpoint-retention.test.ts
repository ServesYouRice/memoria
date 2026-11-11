import { randomBytes } from "crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { OutboxJob } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { createWorkspaceCheckpoint } from "@/lib/agents/service-core";
import { createMaintenanceRetentionHandler } from "@/lib/retention/outbox-handler";

afterAll(async () => {
  await prisma.$disconnect();
});
afterEach(() => {
  delete process.env.WORKSPACE_CHECKPOINT_RETENTION_DAYS;
  delete process.env.WORKSPACE_CHECKPOINT_MAX_PER_SCOPE;
});

const DAY = 86_400_000;

async function seed() {
  const user = await prisma.user.create({
    data: {
      email: `checkpoints-${randomBytes(6).toString("hex")}@example.com`,
    },
  });
  const canvas = await prisma.canvas.create({
    data: { name: "Checkpointed", userId: user.id },
  });
  const profile = await prisma.agentProfile.create({
    data: { userId: user.id, name: "Bulk agent" },
  });
  return { user, canvas, profile };
}

async function insertCheckpoints(input: {
  userId: string;
  canvasId: string;
  agentProfileId: string;
  count: number;
  ageDays: (index: number) => number;
}) {
  // One clock reading for the whole batch: a millisecond tick between rows
  // would otherwise reorder them.
  const now = Date.now();
  await prisma.workspaceCheckpoint.createMany({
    data: Array.from({ length: input.count }, (_, index) => ({
      userId: input.userId,
      scopeType: "canvas",
      scopeId: input.canvasId,
      snapshot: {},
      reason: `checkpoint ${index}`,
      createdByActorType: "AGENT" as const,
      createdByActorId: input.agentProfileId,
      createdAt: new Date(now - input.ageDays(index) * DAY - index),
    })),
  });
}

function maintenanceJob(): OutboxJob {
  return {
    id: `job-${randomBytes(6).toString("hex")}`,
    type: "retention.maintenance",
    payload: {},
  } as unknown as OutboxJob;
}

async function remaining(canvasId: string) {
  return prisma.workspaceCheckpoint.findMany({
    where: { scopeType: "canvas", scopeId: canvasId },
    orderBy: { createdAt: "desc" },
    select: { id: true, reason: true, createdAt: true },
  });
}

describe("workspace checkpoint retention (PostgreSQL)", () => {
  it("keeps only the newest 50 per canvas and nothing older than 90 days", async () => {
    const { user, canvas, profile } = await seed();
    // 60 recent checkpoints (one day old) and 5 that are 100 days old.
    await insertCheckpoints({
      userId: user.id,
      canvasId: canvas.id,
      agentProfileId: profile.id,
      count: 60,
      ageDays: () => 1,
    });
    await insertCheckpoints({
      userId: user.id,
      canvasId: canvas.id,
      agentProfileId: profile.id,
      count: 5,
      ageDays: () => 100,
    });
    const newest = (await remaining(canvas.id)).slice(0, 50);

    const handler = createMaintenanceRetentionHandler(prisma);
    await handler(maintenanceJob());
    const kept = await remaining(canvas.id);
    expect(kept.map((row) => row.id)).toEqual(newest.map((row) => row.id));

    // Running it again changes nothing.
    await handler(maintenanceJob());
    expect((await remaining(canvas.id)).map((row) => row.id)).toEqual(
      newest.map((row) => row.id),
    );
  });

  it("drops checkpoints past the age limit even under the count limit", async () => {
    const { user, canvas, profile } = await seed();
    await insertCheckpoints({
      userId: user.id,
      canvasId: canvas.id,
      agentProfileId: profile.id,
      count: 3,
      ageDays: (index) => (index === 0 ? 10 : 95),
    });

    await createMaintenanceRetentionHandler(prisma)(maintenanceJob());

    expect((await remaining(canvas.id)).map((row) => row.reason)).toEqual([
      "checkpoint 0",
    ]);
  });

  it("reads both limits from configuration", async () => {
    const { user, canvas, profile } = await seed();
    await insertCheckpoints({
      userId: user.id,
      canvasId: canvas.id,
      agentProfileId: profile.id,
      count: 6,
      ageDays: (index) => (index < 4 ? 1 : 20),
    });
    process.env.WORKSPACE_CHECKPOINT_RETENTION_DAYS = "10";
    process.env.WORKSPACE_CHECKPOINT_MAX_PER_SCOPE = "3";

    await createMaintenanceRetentionHandler(prisma)(maintenanceJob());

    expect((await remaining(canvas.id)).map((row) => row.reason)).toEqual([
      "checkpoint 0",
      "checkpoint 1",
      "checkpoint 2",
    ]);
  });

  it("keeps an old checkpoint an open bulk suggestion still needs", async () => {
    const { user, canvas, profile } = await seed();
    await insertCheckpoints({
      userId: user.id,
      canvasId: canvas.id,
      agentProfileId: profile.id,
      count: 2,
      ageDays: () => 120,
    });
    const [needed, unneeded] = await remaining(canvas.id);
    await prisma.suggestion.create({
      data: {
        userId: user.id,
        agentProfileId: profile.id,
        kind: "INTERNAL_ORGANIZATION",
        status: "OPEN",
        summary: "Bulk add",
        expiresAt: new Date(Date.now() + DAY),
        payload: {
          kind: "canvas-item-batch-create",
          canvasId: canvas.id,
          items: [],
          executionMode: "bulk",
          checkpointId: needed!.id,
        },
      },
    });
    await prisma.suggestion.create({
      data: {
        userId: user.id,
        agentProfileId: profile.id,
        kind: "INTERNAL_ORGANIZATION",
        status: "EXECUTED",
        summary: "Bulk add (done)",
        expiresAt: new Date(Date.now() + DAY),
        payload: {
          kind: "canvas-item-batch-create",
          canvasId: canvas.id,
          items: [],
          executionMode: "bulk",
          checkpointId: unneeded!.id,
        },
      },
    });

    await createMaintenanceRetentionHandler(prisma)(maintenanceJob());

    expect((await remaining(canvas.id)).map((row) => row.id)).toEqual([
      needed!.id,
    ]);
  });

  it("deletes a canvas's checkpoints with the canvas", async () => {
    const { user, canvas, profile } = await seed();
    await createWorkspaceCheckpoint({
      actor: { userId: user.id, agentProfileId: profile.id },
      canvasId: canvas.id,
      reason: "before a bulk write",
    });
    expect(await remaining(canvas.id)).toHaveLength(1);

    await prisma.canvas.delete({ where: { id: canvas.id } });

    expect(await remaining(canvas.id)).toHaveLength(0);
  });
});
