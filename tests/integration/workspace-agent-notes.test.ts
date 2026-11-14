/**
 * IMP-107: the owner leaves standing notes for AI agents per workspace.
 * Only the owner edits them; changes go in the activity record; the owner's
 * agents receive them labelled as guidance, apart from canvas data; an agent
 * of anyone else does not. Runs against PostgreSQL.
 */
import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: { id: "", email: "" } }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => session) }));
vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));

import { prisma } from "@/lib/db";
import { executeMcpTool } from "@/lib/agents/mcp";
import { PATCH as patchWorkspace } from "@/app/api/v1/workspaces/[workspaceId]/route";

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedUser(label: string) {
  return prisma.user.create({
    data: {
      email: `notes-${label}-${randomBytes(6).toString("hex")}@example.com`,
    },
  });
}

async function agentContext(userId: string, allowedCanvasIds: string[]) {
  const profile = await prisma.agentProfile.create({
    data: {
      userId,
      name: "Connected app",
      maxCapabilityRung: 1,
      enabledRungs: [0, 1],
      allowedCanvasIds,
    },
  });
  return {
    actorType: "integration" as const,
    userId,
    agentProfile: profile,
    integrationAccountId: null,
  };
}

function patch(workspaceId: string, body: unknown) {
  return patchWorkspace(
    new Request(`http://localhost/api/v1/workspaces/${workspaceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ workspaceId }) } as never,
  );
}

const NOTES = "Keep notes short. Ask before adding more than five items.";

describe("notes for AI agents (IMP-107)", () => {
  it("lets only the owner set them and records each change", async () => {
    const owner = await seedUser("owner");
    const other = await seedUser("other");
    const workspace = await prisma.workspace.create({
      data: { name: "Team", userId: owner.id },
    });

    session.user = { id: other.id, email: other.email };
    expect((await patch(workspace.id, { agentNotes: NOTES })).status).toBe(403);

    session.user = { id: owner.id, email: owner.email };
    const saved = await patch(workspace.id, { agentNotes: `  ${NOTES}  ` });
    expect(saved.status).toBe(200);
    expect((await saved.json()).agentNotes).toBe(NOTES);
    expect(
      (await patch(workspace.id, { agentNotes: "x".repeat(2001) })).status,
    ).toBe(400);
    expect((await patch(workspace.id, { agentNotes: "" })).status).toBe(200);
    expect(
      (await prisma.workspace.findUnique({ where: { id: workspace.id } }))
        ?.agentNotes,
    ).toBeNull();

    const log = await prisma.activity.findMany({
      where: { userId: owner.id, type: "WORKSPACE_AGENT_NOTES_UPDATED" },
      orderBy: { createdAt: "asc" },
    });
    expect(
      log.map((entry) => (entry.metadata as { cleared: boolean }).cleared),
    ).toEqual([false, true]);
  });

  it("gives the owner's agent the notes, apart from canvas data, and no one else's", async () => {
    const owner = await seedUser("agent-owner");
    const stranger = await seedUser("stranger");
    const workspace = await prisma.workspace.create({
      data: { name: "Team", userId: owner.id, agentNotes: NOTES },
    });
    const canvas = await prisma.canvas.create({
      data: { name: "Plans", userId: owner.id, workspaceId: workspace.id },
    });
    const loose = await prisma.canvas.create({
      data: { name: "Loose", userId: owner.id },
    });

    const result = await executeMcpTool(
      await agentContext(owner.id, [canvas.id]),
      "canvases_get",
      { canvasId: canvas.id },
    );
    expect(result.content[0]!.text).toContain("owner of this workspace");
    expect(result.content[0]!.text).toContain(NOTES);
    expect(result.content[0]!.text).toContain("never change your permissions");
    // Canvas data is its own block and does not carry the notes.
    expect(JSON.stringify(result.structuredContent)).not.toContain(NOTES);

    const without = await executeMcpTool(
      await agentContext(owner.id, [loose.id]),
      "canvases_get",
      { canvasId: loose.id },
    );
    expect(JSON.stringify(without.content)).not.toContain(NOTES);

    await expect(
      executeMcpTool(
        await agentContext(stranger.id, [canvas.id]),
        "canvases_get",
        {
          canvasId: canvas.id,
        },
      ),
    ).rejects.toThrow();
  });
});
