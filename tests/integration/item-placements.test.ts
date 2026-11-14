/**
 * IMP-109: one item on several canvases, against PostgreSQL. Content lives
 * once; each other canvas holds only where the item sits. Covers placing,
 * permissions, the item limit, the live notice, removing, trash, search,
 * version restore, export and sharing for a shared item.
 */
import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const session = vi.hoisted(() => ({ user: { id: "", email: "" } }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => session) }));
vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));
vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));

import { prisma } from "@/lib/db";
import { canvasItemRoom } from "@/lib/policy/capacity";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";
import { recordCanvasItemEvent } from "@/lib/collaboration/committed-events";
import { createCanvasEventHandler } from "@/lib/collaboration/event-outbox-handler";
import {
  GET as itemPlacements,
  POST as placeItem,
} from "@/app/api/v1/canvas-items/[itemId]/placements/route";
import { GET as canvasPlacements } from "@/app/api/v1/canvases/[canvasId]/placements/route";
import {
  DELETE as removePlacement,
  PATCH as movePlacement,
} from "@/app/api/v1/canvases/[canvasId]/placements/[placementId]/route";
import { GET as placedElsewhere } from "@/app/api/v1/canvases/[canvasId]/placements/elsewhere/route";
import { GET as search } from "@/app/api/v1/search/route";
import {
  GET as listTrash,
  PATCH as restoreFromTrash,
} from "@/app/api/v1/trash/route";
import { POST as createVersion } from "@/app/api/v1/canvases/[canvasId]/versions/route";
import { POST as restoreVersion } from "@/app/api/v1/canvases/[canvasId]/versions/[versionId]/restore/route";

afterAll(async () => {
  await prisma.$disconnect();
});

const tag = () => randomBytes(6).toString("hex");

function as(user: { id: string; email: string }) {
  session.user = { id: user.id, email: user.email };
}

function request(url: string, method = "GET", body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function seed() {
  const id = tag();
  const owner = await prisma.user.create({
    data: { email: `place-owner-${id}@example.com` },
  });
  const other = await prisma.user.create({
    data: { email: `place-other-${id}@example.com` },
  });
  const home = await prisma.canvas.create({
    data: { name: "Home", userId: owner.id },
  });
  const second = await prisma.canvas.create({
    data: { name: "Second", userId: owner.id },
  });
  const third = await prisma.canvas.create({
    data: { name: "Third", userId: owner.id },
  });
  const word = `wombat${id}`;
  const item = await prisma.canvasItem.create({
    data: {
      canvasId: home.id,
      type: "NOTE",
      positionX: 10,
      positionY: 20,
      width: 200,
      height: 100,
      content: { text: `plan ${word}` },
      createdById: owner.id,
    },
  });
  return { owner, other, home, second, third, item, word };
}

async function place(itemId: string, canvasId: string) {
  return placeItem(
    request(`/api/v1/canvas-items/${itemId}/placements`, "POST", { canvasId }),
    { params: Promise.resolve({ itemId }) },
  );
}

async function placedOn(canvasId: string) {
  const response = await canvasPlacements(
    request(`/api/v1/canvases/${canvasId}/placements`),
    { params: Promise.resolve({ canvasId }) },
  );
  return { status: response.status, body: await response.json() };
}

describe("one item on several canvases (IMP-109)", () => {
  it("lets the owner show an item on their other canvases, once each", async () => {
    const { owner, other, home, second, third, item } = await seed();
    as(owner);
    const roomBefore = await canvasItemRoom(prisma, second.id);

    const created = await place(item.id, second.id);
    expect(created.status).toBe(201);
    expect((await place(item.id, third.id)).status).toBe(201);
    // Once per canvas, never on its own home.
    expect((await place(item.id, second.id)).status).toBe(409);
    expect((await place(item.id, home.id)).status).toBe(422);
    // Each placement takes a place on that canvas.
    expect(await canvasItemRoom(prisma, second.id)).toBe(roomBefore - 1);
    expect(roomBefore).toBe(LAUNCH_LIMITS.itemsPerCanvas);

    const listed = await itemPlacements(
      request(`/api/v1/canvas-items/${item.id}/placements`),
      { params: Promise.resolve({ itemId: item.id }) },
    );
    const body = await listed.json();
    expect(body.homeCanvasId).toBe(home.id);
    expect(
      body.placements.map((p: { canvasName: string }) => p.canvasName),
    ).toEqual(["Second", "Third"]);

    const shown = await placedOn(second.id);
    expect(shown.body.placements).toHaveLength(1);
    expect(shown.body.placements[0]).toMatchObject({
      homeCanvasId: home.id,
      homeCanvasName: "Home",
      item: { id: item.id, positionX: 10, content: item.content },
    });

    // Not onto someone else's canvas, and not by someone else.
    const foreign = await prisma.canvas.create({
      data: { name: "Theirs", userId: other.id },
    });
    const otherItem = await prisma.canvasItem.create({
      data: {
        canvasId: home.id,
        type: "NOTE",
        positionX: 0,
        positionY: 0,
        width: 10,
        height: 10,
        content: { text: "x" },
        createdById: owner.id,
      },
    });
    expect((await place(otherItem.id, foreign.id)).status).toBe(404);
    as(other);
    expect((await place(otherItem.id, foreign.id)).status).toBe(403);
  });

  it("shows an edit everywhere and tells the other canvases at once", async () => {
    const { owner, second, third, item } = await seed();
    as(owner);
    await place(item.id, second.id);
    await place(item.id, third.id);

    const updated = await prisma.canvasItem.update({
      where: { id: item.id },
      data: { content: { text: "changed once" }, version: { increment: 1 } },
    });
    const event = await recordCanvasItemEvent(prisma, {
      canvasId: item.canvasId,
      actorId: owner.id,
      itemId: item.id,
      version: updated.version,
      operation: "updated",
    });
    const published: Array<[string, string]> = [];
    await createCanvasEventHandler(prisma, async (channel, message) => {
      published.push([channel, message]);
    })({
      id: "cljob00000000000000000000",
      payload: { eventId: event.id },
    } as never);
    const notices = published.filter(([, message]) =>
      message.includes('"placement-changed"'),
    );
    expect(notices.map(([channel]) => channel).sort()).toEqual(
      [
        `memoria:collaboration:canvas:${second.id}`,
        `memoria:collaboration:canvas:${third.id}`,
      ].sort(),
    );
    for (const canvasId of [second.id, third.id]) {
      const shown = await placedOn(canvasId);
      expect(shown.body.placements[0].item.content).toEqual({
        text: "changed once",
      });
    }
  });

  it("moves or removes it on one canvas and leaves the others", async () => {
    const { owner, home, second, third, item } = await seed();
    as(owner);
    const placement = await (await place(item.id, second.id)).json();
    await place(item.id, third.id);
    const ctx = {
      params: Promise.resolve({
        canvasId: second.id,
        placementId: placement.id,
      }),
    };
    const moved = await movePlacement(
      request(
        `/api/v1/canvases/${second.id}/placements/${placement.id}`,
        "PATCH",
        { positionX: 500 },
      ),
      ctx,
    );
    expect(moved.status).toBe(200);
    expect(
      (await prisma.canvasItem.findUniqueOrThrow({ where: { id: item.id } }))
        .positionX,
    ).toBe(10);

    const removed = await removePlacement(
      request(
        `/api/v1/canvases/${second.id}/placements/${placement.id}`,
        "DELETE",
      ),
      ctx,
    );
    expect(removed.status).toBe(204);
    expect((await placedOn(second.id)).body.placements).toEqual([]);
    expect((await placedOn(third.id)).body.placements).toHaveLength(1);
    expect(
      await prisma.canvasItem.findFirst({
        where: { id: item.id, canvasId: home.id, deletedAt: null },
      }),
    ).not.toBeNull();
  });

  it("says where else it disappears, trashes it once and restores it everywhere", async () => {
    const { owner, home, second, third, item } = await seed();
    as(owner);
    await place(item.id, second.id);
    await place(item.id, third.id);

    const before = await placedElsewhere(
      request(
        `/api/v1/canvases/${home.id}/placements/elsewhere?itemIds=${item.id}`,
      ),
      { params: Promise.resolve({ canvasId: home.id }) },
    );
    expect((await before.json()).items[item.id]).toEqual({
      count: 2,
      canvasNames: ["Second", "Third"],
    });

    await prisma.canvasItem.update({
      where: { id: item.id },
      data: {
        deletedAt: new Date(),
        deletedById: owner.id,
        version: { increment: 1 },
      },
    });
    expect((await placedOn(second.id)).body.placements).toEqual([]);
    const trash = await (await listTrash(request("/api/v1/trash"))).json();
    const inTrash = (trash.items ?? []).filter(
      (entry: { id: string }) => entry.id === item.id,
    );
    expect(inTrash).toHaveLength(1);

    const deleted = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    const restored = await restoreFromTrash(
      request("/api/v1/trash", "PATCH", {
        itemId: item.id,
        version: deleted.version,
      }),
    );
    expect(restored.status).toBe(200);
    expect((await placedOn(second.id)).body.placements).toHaveLength(1);
    expect((await placedOn(third.id)).body.placements).toHaveLength(1);

    // Deleted for good, its placements go with it.
    await prisma.canvasItem.delete({ where: { id: item.id } });
    expect(
      await prisma.itemPlacement.count({ where: { itemId: item.id } }),
    ).toBe(0);
  });

  it("is found once by search", async () => {
    const { owner, second, third, item, word } = await seed();
    as(owner);
    await place(item.id, second.id);
    await place(item.id, third.id);
    const body = await (
      await search(request(`/api/v1/search?q=${word}`))
    ).json();
    expect(
      body.results.filter(
        (result: { itemId: string }) => result.itemId === item.id,
      ),
    ).toHaveLength(1);
  });

  it("keeps a shown item when the other canvas restores an older version", async () => {
    const { owner, second, item } = await seed();
    as(owner);
    const version = await (
      await createVersion(
        request(`/api/v1/canvases/${second.id}/versions`, "POST", {
          name: "Before",
        }),
        { params: Promise.resolve({ canvasId: second.id }) },
      )
    ).json();
    await place(item.id, second.id);
    const restored = await restoreVersion(
      request(
        `/api/v1/canvases/${second.id}/versions/${version.id}/restore`,
        "POST",
      ),
      {
        params: Promise.resolve({
          canvasId: second.id,
          versionId: version.id,
        }),
      },
    );
    expect(restored.status).toBe(200);
    // The item lives on its home canvas; a version of this canvas holds
    // only its own items, so the shown item and its original stay.
    expect((await placedOn(second.id)).body.placements).toHaveLength(1);
    expect(
      (await prisma.canvasItem.findUniqueOrThrow({ where: { id: item.id } }))
        .deletedAt,
    ).toBeNull();
  });

  it("shows it to people the canvas is shared with, read-only there", async () => {
    const { owner, other, second, item } = await seed();
    as(owner);
    const placement = await (await place(item.id, second.id)).json();

    as(other);
    expect((await placedOn(second.id)).status).toBe(403);

    await prisma.canvasShare.create({
      data: {
        canvasId: second.id,
        email: other.email,
        recipientId: other.id,
        role: "VIEW",
      },
    });
    const shown = await placedOn(second.id);
    expect(shown.status).toBe(200);
    // The viewer cannot open the home canvas, so it is not named.
    expect(shown.body.placements[0]).toMatchObject({
      homeCanvasName: null,
      item: { id: item.id },
    });
    const moved = await movePlacement(
      request(
        `/api/v1/canvases/${second.id}/placements/${placement.id}`,
        "PATCH",
        { positionX: 1 },
      ),
      {
        params: Promise.resolve({
          canvasId: second.id,
          placementId: placement.id,
        }),
      },
    );
    expect(moved.status).toBe(403);
    // A viewer of the other canvas is no one to ask where it is shown.
    const listed = await itemPlacements(
      request(`/api/v1/canvas-items/${item.id}/placements`),
      { params: Promise.resolve({ itemId: item.id }) },
    );
    expect(listed.status).toBe(403);
  });
});
