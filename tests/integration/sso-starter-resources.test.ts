import { randomBytes } from "crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ensureStarterResources } from "@/lib/auth/sso";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Starter workspace for a login-system account (IMP-099, PostgreSQL)", () => {
  it("gives a new account one Personal workspace with an Inbox, even when run twice at once", async () => {
    const user = await prisma.user.create({
      data: { email: `sso-${randomBytes(6).toString("hex")}@example.com` },
    });
    await Promise.all([
      ensureStarterResources(prisma, user.id),
      ensureStarterResources(prisma, user.id),
    ]);
    await ensureStarterResources(prisma, user.id);
    const workspaces = await prisma.workspace.findMany({
      where: { userId: user.id },
      include: { canvases: true },
    });
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]!.name).toBe("Personal");
    expect(workspaces[0]!.canvases.map((c) => c.name)).toEqual(["Inbox"]);
  });
});
