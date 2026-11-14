import { randomBytes } from "crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// IMP-132: a deleted canvas goes to Trash. The real auth helpers run, so a
// trashed canvas has to read as missing through them, not through a mock.
const session = vi.hoisted(() => ({
  current: null as null | { user: { id: string; email: string } },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => session.current) }));
vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  return {
    prisma: new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    }),
  };
});

import { prisma } from "@/lib/db";
import { GET as listCanvases } from "@/app/api/v1/canvases/route";
import {
  DELETE as deleteCanvas,
  GET as getCanvas,
  PATCH as patchCanvas,
} from "@/app/api/v1/canvases/[canvasId]/route";
import { POST as restoreCanvas } from "@/app/api/v1/canvases/[canvasId]/restore/route";
import { GET as getPublicShare } from "@/app/api/v1/share/[token]/route";
import { GET as search } from "@/app/api/v1/search/route";
import { GET as getTrash } from "@/app/api/v1/trash/route";
import { createCanvasEmbed, resolveEmbedToken } from "@/lib/embeds/service";
import { createTrashRetentionHandler } from "@/lib/retention/outbox-handler";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";

const DAY_MS = 86_400_000;

beforeEach(async () => {
  await prisma.outboxJob.deleteMany();
});
afterAll(async () => {
  await prisma.$disconnect();
});

function suffix() {
  return randomBytes(6).toString("hex");
}

async function user(label: string) {
  const row = await prisma.user.create({
    data: { email: `trash-${label}-${suffix()}@example.com` },
  });
  await prisma.uploadQuota.create({
    data: { userId: row.id, assetCount: 0, totalBytes: 0n },
  });
  return row;
}

function as(row: { id: string; email: string } | null) {
  session.current = row ? { user: { id: row.id, email: row.email } } : null;
}

function req(url: string, init?: { method?: string; body?: unknown }) {
  return new NextRequest(`http://localhost${url}`, {
    method: init?.method ?? "GET",
    ...(init?.body === undefined
      ? {}
      : {
          body: JSON.stringify(init.body),
          headers: { "Content-Type": "application/json" },
        }),
  });
}

const canvasCtx = (canvasId: string) => ({
  params: Promise.resolve({ canvasId }),
});

/** Status and problem text, without the instance URL that names the id. */
async function problem(response: Response) {
  const body = await response.json();
  return { status: response.status, title: body.title, detail: body.detail };
}

/** An owner's canvas with a note, a collaborator share, a public link, an
 * embed, a saved version, a thumbnail and one charged upload. */
async function seed() {
  const owner = await user("owner");
  const collaborator = await user("collab");
  const word = `zebra${suffix()}`;
  const canvas = await prisma.canvas.create({
    data: {
      name: "Doomed board",
      userId: owner.id,
      isPublic: true,
      shareToken: `tok-${suffix()}`,
      thumbnailKey: `thumbnails/${suffix()}.png`,
      shares: {
        create: {
          email: collaborator.email,
          recipientId: collaborator.id,
          role: "EDIT",
        },
      },
    },
  });
  const item = await prisma.canvasItem.create({
    data: {
      canvasId: canvas.id,
      type: "NOTE",
      positionX: 0,
      positionY: 0,
      width: 200,
      height: 200,
      content: { text: `a ${word} note` },
      createdById: owner.id,
    },
  });
  await prisma.canvasVersion.create({
    data: {
      canvasId: canvas.id,
      name: "Saved",
      snapshot: { schemaVersion: 1, items: [] },
      kind: "MANUAL",
    },
  });
  const asset = await prisma.uploadAsset.create({
    data: {
      userId: owner.id,
      canvasId: canvas.id,
      storageKey: `uploads/${owner.id}/${suffix()}.png`,
      storageMode: "local",
      filename: "a.png",
      mimeType: "image/png",
      size: 100,
      status: "ACTIVE",
    },
  });
  await prisma.uploadQuota.update({
    where: { userId: owner.id },
    data: { assetCount: 1, totalBytes: 100n },
  });
  const { token: embedToken } = await createCanvasEmbed(
    prisma,
    canvas.id,
    owner.id,
    { label: "Site", allowedOrigins: ["https://example.com"] },
  );
  return { owner, collaborator, canvas, item, asset, word, embedToken };
}

async function trash(canvasId: string) {
  return deleteCanvas(
    req(`/api/v1/canvases/${canvasId}`, { method: "DELETE" }),
    canvasCtx(canvasId),
  );
}

async function quota(userId: string) {
  const row = await prisma.uploadQuota.findUniqueOrThrow({ where: { userId } });
  return { count: row.assetCount, bytes: Number(row.totalBytes) };
}

describe("canvas Trash (IMP-132)", () => {
  it("keeps the row and purges nothing when a canvas is deleted", async () => {
    const { owner, canvas, item, asset } = await seed();
    as(owner);
    const response = await trash(canvas.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: "Canvas moved to Trash",
      trashed: true,
    });

    const row = await prisma.canvas.findUniqueOrThrow({
      where: { id: canvas.id },
    });
    expect(row.deletedAt).toBeInstanceOf(Date);
    expect(row.deletedById).toBe(owner.id);
    expect(
      await prisma.canvasItem.findUnique({ where: { id: item.id } }),
    ).not.toBeNull();
    expect(
      (await prisma.uploadAsset.findUniqueOrThrow({ where: { id: asset.id } }))
        .status,
    ).toBe("ACTIVE");
    expect(await quota(owner.id)).toEqual({ count: 1, bytes: 100 });
    expect(await prisma.outboxJob.count()).toBe(0);
  });

  it("answers like a missing canvas everywhere but the owner's Trash", async () => {
    const { owner, collaborator, canvas, word, embedToken } = await seed();
    const missing = `c${suffix()}missing`;
    as(owner);
    // Before: everything works, so the checks below test the trash state.
    expect(
      (
        await getCanvas(
          req(`/api/v1/canvases/${canvas.id}`),
          canvasCtx(canvas.id),
        )
      ).status,
    ).toBe(200);
    expect(await resolveEmbedToken(prisma, embedToken)).not.toBeNull();
    expect((await trash(canvas.id)).status).toBe(200);

    // Missing from the list.
    const list = await (await listCanvases(req("/api/v1/canvases"))).json();
    expect(list.canvases.map((c: { id: string }) => c.id)).not.toContain(
      canvas.id,
    );

    // GET, PATCH and a second DELETE answer exactly like an unknown id.
    for (const [call, unknown] of [
      [
        () =>
          getCanvas(req(`/api/v1/canvases/${canvas.id}`), canvasCtx(canvas.id)),
        () => getCanvas(req(`/api/v1/canvases/${missing}`), canvasCtx(missing)),
      ],
      [
        () =>
          patchCanvas(
            req(`/api/v1/canvases/${canvas.id}`, {
              method: "PATCH",
              body: { name: "Renamed" },
            }),
            canvasCtx(canvas.id),
          ),
        () =>
          patchCanvas(
            req(`/api/v1/canvases/${missing}`, {
              method: "PATCH",
              body: { name: "Renamed" },
            }),
            canvasCtx(missing),
          ),
      ],
      [() => trash(canvas.id), () => trash(missing)],
    ] as const) {
      const got = await problem(await call());
      expect(got.status).toBeGreaterThanOrEqual(400);
      expect(got).toEqual(await problem(await unknown()));
    }

    // Item search does not return its items.
    const found = await (
      await search(req(`/api/v1/search?q=${word}`), {} as never)
    ).json();
    expect(found.results).toEqual([]);

    // The public share link and the embed answer like unknown tokens.
    const shareToken = canvas.shareToken!;
    as(null);
    const share = await getPublicShare(req(`/api/v1/share/${shareToken}`), {
      params: Promise.resolve({ token: shareToken }),
    });
    const unknownShare = await getPublicShare(req(`/api/v1/share/nope`), {
      params: Promise.resolve({ token: "nope" }),
    });
    expect(await problem(share)).toEqual(await problem(unknownShare));
    expect(share.status).toBe(404);
    expect(await resolveEmbedToken(prisma, embedToken)).toBeNull();

    // A collaborator gets the same answer as for a canvas that never was.
    as(collaborator);
    expect(
      await problem(
        await getCanvas(
          req(`/api/v1/canvases/${canvas.id}`),
          canvasCtx(canvas.id),
        ),
      ),
    ).toEqual(
      await problem(
        await getCanvas(req(`/api/v1/canvases/${missing}`), canvasCtx(missing)),
      ),
    );
    const collaboratorTrash = await (
      await getTrash(req("/api/v1/trash"))
    ).json();
    expect(collaboratorTrash.canvases).toEqual([]);
    expect(
      (
        await restoreCanvas(
          req(`/api/v1/canvases/${canvas.id}/restore`, { method: "POST" }),
          canvasCtx(canvas.id),
        )
      ).status,
    ).toBe(403);

    // The owner's Trash lists it, with its live item count.
    as(owner);
    const ownerTrash = await (await getTrash(req("/api/v1/trash"))).json();
    expect(ownerTrash.canvases).toEqual([
      {
        id: canvas.id,
        name: "Doomed board",
        deletedAt: expect.any(String),
        itemCount: 1,
      },
    ]);
    expect(ownerTrash.items).toEqual([]);
  });

  it("does not list a trashed canvas's own trashed items as items", async () => {
    const { owner, canvas, item } = await seed();
    await prisma.canvasItem.update({
      where: { id: item.id },
      data: { deletedAt: new Date(), deletedById: owner.id },
    });
    as(owner);
    let body = await (await getTrash(req("/api/v1/trash"))).json();
    expect(body.items.map((row: { id: string }) => row.id)).toContain(item.id);
    expect((await trash(canvas.id)).status).toBe(200);
    body = await (await getTrash(req("/api/v1/trash"))).json();
    expect(body.items.map((row: { id: string }) => row.id)).not.toContain(
      item.id,
    );
    expect(body.canvases[0]).toMatchObject({ id: canvas.id, itemCount: 0 });
  });

  it("restores the canvas exactly as it was", async () => {
    const { owner, collaborator, canvas, item, asset, word, embedToken } =
      await seed();
    as(owner);
    expect((await trash(canvas.id)).status).toBe(200);

    // Restoring a canvas that is not in Trash reads as not found.
    const other = await prisma.canvas.create({
      data: { name: "Live", userId: owner.id },
    });
    const notTrashed = await restoreCanvas(
      req(`/api/v1/canvases/${other.id}/restore`, { method: "POST" }),
      canvasCtx(other.id),
    );
    expect(notTrashed.status).toBe(403);

    const response = await restoreCanvas(
      req(`/api/v1/canvases/${canvas.id}/restore`, { method: "POST" }),
      canvasCtx(canvas.id),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: canvas.id,
      name: "Doomed board",
      deletedAt: null,
      isPublic: true,
      shareToken: canvas.shareToken,
    });
    expect(
      await prisma.canvas.findUniqueOrThrow({
        where: { id: canvas.id },
        select: { deletedAt: true, deletedById: true },
      }),
    ).toEqual({ deletedAt: null, deletedById: null });

    const list = await (await listCanvases(req("/api/v1/canvases"))).json();
    expect(list.canvases.map((c: { id: string }) => c.id)).toContain(canvas.id);
    expect(
      (
        await getCanvas(
          req(`/api/v1/canvases/${canvas.id}`),
          canvasCtx(canvas.id),
        )
      ).status,
    ).toBe(200);
    expect(
      await prisma.canvasItem.count({ where: { canvasId: canvas.id } }),
    ).toBe(1);
    expect(
      await prisma.canvasVersion.count({ where: { canvasId: canvas.id } }),
    ).toBe(1);
    expect(
      (await prisma.uploadAsset.findUniqueOrThrow({ where: { id: asset.id } }))
        .status,
    ).toBe("ACTIVE");
    const found = await (
      await search(req(`/api/v1/search?q=${word}`), {} as never)
    ).json();
    expect(found.results.map((row: { itemId: string }) => row.itemId)).toEqual([
      item.id,
    ]);
    expect(await resolveEmbedToken(prisma, embedToken)).not.toBeNull();

    as(null);
    const share = await getPublicShare(
      req(`/api/v1/share/${canvas.shareToken}`),
      { params: Promise.resolve({ token: canvas.shareToken! }) },
    );
    expect(share.status).toBe(200);
    as(collaborator);
    expect(
      (
        await getCanvas(
          req(`/api/v1/canvases/${canvas.id}`),
          canvasCtx(canvas.id),
        )
      ).status,
    ).toBe(200);
  });

  it("checks the canvas limit before restoring, and trash does not count", async () => {
    const owner = await user("limit");
    const canvases = await prisma.canvas.createManyAndReturn({
      data: Array.from({ length: LAUNCH_LIMITS.canvasesPerUser }, (_, i) => ({
        name: `Board ${i}`,
        userId: owner.id,
      })),
      select: { id: true },
    });
    as(owner);
    const victim = canvases[0]!.id;
    expect((await trash(victim)).status).toBe(200);
    // The trashed canvas frees its place, so a new one fits.
    await prisma.canvas.create({ data: { name: "Newer", userId: owner.id } });
    const response = await restoreCanvas(
      req(`/api/v1/canvases/${victim}/restore`, { method: "POST" }),
      canvasCtx(victim),
    );
    expect(response.status).toBe(422);
    const row = await prisma.canvas.findUniqueOrThrow({
      where: { id: victim },
    });
    expect(row.deletedAt).not.toBeNull();
  });

  it("purges after the retention window, once, and a second sweep is harmless", async () => {
    const { owner, canvas, asset } = await seed();
    const fresh = await seed();
    as(owner);
    expect((await trash(canvas.id)).status).toBe(200);
    as(fresh.owner);
    expect((await trash(fresh.canvas.id)).status).toBe(200);
    await prisma.canvas.update({
      where: { id: canvas.id },
      data: {
        deletedAt: new Date(
          Date.now() - (LAUNCH_LIMITS.trashRetentionDays + 1) * DAY_MS,
        ),
      },
    });

    const sweep = createTrashRetentionHandler(prisma as never);
    await sweep({ id: "sweep-1", type: "retention.trash" } as never);

    expect(
      await prisma.canvas.findUnique({ where: { id: canvas.id } }),
    ).toBeNull();
    expect(await quota(owner.id)).toEqual({ count: 0, bytes: 0 });
    const jobs = await prisma.outboxJob.findMany({
      select: { type: true, dedupeKey: true },
      orderBy: { type: "asc" },
    });
    expect(jobs).toEqual([
      { type: "thumbnail.delete", dedupeKey: expect.any(String) },
      { type: "upload.delete", dedupeKey: `upload.delete:${asset.id}` },
    ]);
    // Inside the window: kept.
    expect(
      (
        await prisma.canvas.findUniqueOrThrow({
          where: { id: fresh.canvas.id },
        })
      ).deletedAt,
    ).not.toBeNull();
    expect(await quota(fresh.owner.id)).toEqual({ count: 1, bytes: 100 });

    await sweep({ id: "sweep-2", type: "retention.trash" } as never);
    expect(await quota(owner.id)).toEqual({ count: 0, bytes: 0 });
    expect(await prisma.outboxJob.count()).toBe(2);
  });
});
