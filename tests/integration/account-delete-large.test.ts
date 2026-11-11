import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

const authState = vi.hoisted(() => ({ userId: "", email: "" }));
vi.mock("@/lib/api/auth", () => ({
  requireAuth: async () => ({ ...authState }),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/auth/credentials", () => ({
  getCredentialPasswordHash: vi.fn(async () => "stored-hash"),
}));
vi.mock("@/lib/auth/password", () => ({
  verifyPassword: vi.fn(async () => true),
}));

import { DELETE as deleteAccount } from "@/app/api/v1/users/account/route";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";

// Near LAUNCH_LIMITS: every upload and every canvas, with 50 items each by
// default. ACCOUNT_DELETE_ITEMS=2000 seeds the full item cap (400,000 rows,
// minutes to seed) to measure the transaction at the limit.
const CANVASES = LAUNCH_LIMITS.canvasesPerUser;
const ITEMS_PER_CANVAS = Number(process.env.ACCOUNT_DELETE_ITEMS ?? 50);
const FOREIGN_ITEMS = 1_000;

afterAll(async () => {
  await prisma.$disconnect();
});

const item = (
  canvasId: string,
  createdById: string,
  index: number,
  extra = {},
) => ({
  canvasId,
  type: "NOTE" as const,
  positionX: index,
  positionY: 0,
  width: 100,
  height: 100,
  zIndex: index,
  content: { text: `note ${index}` },
  createdById,
  ...extra,
});

describe("account deletion of a large account", () => {
  it(
    "finishes and removes or keeps exactly the listed rows",
    { timeout: 900_000 },
    async () => {
      const tag = randomBytes(6).toString("hex");
      const user = await prisma.user.create({
        data: { email: `large-${tag}@example.com` },
      });
      const owners = await Promise.all(
        [1, 2, 3].map((n) =>
          prisma.user.create({
            data: { email: `owner${n}-${tag}@example.com` },
          }),
        ),
      );
      authState.userId = user.id;
      authState.email = user.email;

      // The user's own canvases with items, and uploads at the launch limit.
      const ownCanvases = await Promise.all(
        Array.from({ length: CANVASES }, (_, n) =>
          prisma.canvas.create({ data: { name: `Own ${n}`, userId: user.id } }),
        ),
      );
      const ownItems = ownCanvases.flatMap((canvas) =>
        Array.from({ length: ITEMS_PER_CANVAS }, (_, n) =>
          item(canvas.id, user.id, n),
        ),
      );
      for (let offset = 0; offset < ownItems.length; offset += 2_000) {
        await prisma.canvasItem.createMany({
          data: ownItems.slice(offset, offset + 2_000),
        });
      }
      await prisma.uploadQuota.create({
        data: {
          userId: user.id,
          assetCount: LAUNCH_LIMITS.uploadsPerUser,
          totalBytes: 0n,
        },
      });
      await prisma.uploadAsset.createMany({
        data: Array.from({ length: LAUNCH_LIMITS.uploadsPerUser }, (_, n) => ({
          userId: user.id,
          canvasId: ownCanvases[n % ownCanvases.length]!.id,
          storageKey: `uploads/${user.id}/${tag}-${n}.png`,
          storageMode: "local",
          filename: "a.png",
          mimeType: "image/png",
          size: 0,
          status: "ACTIVE" as const,
        })),
      });
      // Contributions on other owners' canvases.
      const foreignCanvases = await Promise.all(
        owners.map((owner) =>
          prisma.canvas.create({ data: { name: "Theirs", userId: owner.id } }),
        ),
      );
      await prisma.canvasItem.createMany({
        data: foreignCanvases.flatMap((canvas, c) =>
          Array.from({ length: FOREIGN_ITEMS }, (_, n) =>
            item(canvas.id, n % 2 === 0 ? user.id : owners[c]!.id, n, {
              updatedById: n % 3 === 0 ? user.id : null,
              deletedById: n % 5 === 0 ? user.id : null,
            }),
          ),
        ),
      });
      await prisma.session.create({
        data: {
          userId: user.id,
          token: `tok-${tag}`,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });

      const startedAt = performance.now();
      const response = await deleteAccount(
        new NextRequest("http://localhost/api/v1/users/account", {
          method: "DELETE",
          body: JSON.stringify({ password: "pw", confirmation: "DELETE" }),
        }),
      );
      const elapsedMs = performance.now() - startedAt;
      process.stderr.write(
        `account deletion took ${Math.round(elapsedMs)} ms\n`,
      );
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body).toEqual({
        message: "Account deleted successfully",
        success: true,
      });

      expect(
        await prisma.user.findUnique({ where: { id: user.id } }),
      ).toBeNull();
      expect(await prisma.canvas.count({ where: { userId: user.id } })).toBe(0);
      expect(
        await prisma.canvasItem.count({
          where: { canvasId: { in: ownCanvases.map((c) => c.id) } },
        }),
      ).toBe(0);
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(
        0,
      );
      expect(
        await prisma.uploadAsset.count({ where: { userId: user.id } }),
      ).toBe(0);
      expect(
        await prisma.outboxJob.count({
          where: {
            dedupeKey: { startsWith: "upload.delete:" },
            payload: { path: ["userId"], equals: user.id },
          },
        }),
      ).toBe(LAUNCH_LIMITS.uploadsPerUser);
      for (const [c, canvas] of foreignCanvases.entries()) {
        // Every item is kept, authored by the canvas owner, with no reference
        // to the deleted user.
        expect(
          await prisma.canvasItem.count({ where: { canvasId: canvas.id } }),
        ).toBe(FOREIGN_ITEMS);
        expect(
          await prisma.canvasItem.count({
            where: { canvasId: canvas.id, createdById: { not: owners[c]!.id } },
          }),
        ).toBe(0);
        expect(
          await prisma.canvasItem.count({
            where: {
              canvasId: canvas.id,
              OR: [{ updatedById: user.id }, { deletedById: user.id }],
            },
          }),
        ).toBe(0);
      }
    },
  );
});
