import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

const session = vi.hoisted(() => ({ user: { id: "", email: "" } }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => session) }));

import { GET as search } from "@/app/api/v1/search/route";
import { retrieveOwnedItems } from "@/lib/ai/ask";
import { getScopedItemDetail } from "@/lib/agents/query-core";
import {
  CANVAS_LINKS_BACKFILL_JOB,
  createCanvasLinksBackfillHandler,
  createLinkArrow,
} from "@/lib/canvas/arrow-links";
import type { OutboxJob } from "@/lib/outbox/types";

afterAll(async () => {
  await prisma.$disconnect();
});

async function fixture() {
  const tag = randomBytes(6).toString("hex");
  const user = await prisma.user.create({
    data: { email: `arrow-links-${tag}@example.com` },
  });
  const [canvas, other] = await Promise.all([
    prisma.canvas.create({ data: { name: "Plan", userId: user.id } }),
    prisma.canvas.create({ data: { name: "Elsewhere", userId: user.id } }),
  ]);
  const note = (canvasId: string, x: number) =>
    prisma.canvasItem.create({
      data: {
        canvasId,
        type: "NOTE",
        positionX: x,
        positionY: 0,
        width: 100,
        height: 100,
        zIndex: 5,
        content: { text: `note ${x}` },
        createdById: user.id,
      },
    });
  const a = await note(canvas.id, 0);
  const b = await note(canvas.id, 300);
  const c = await note(canvas.id, 600);
  return { user, canvas, other, a, b, c };
}

function links(canvasId: string) {
  return prisma.itemConnection.findMany({
    where: { canvasId },
    select: { fromId: true, toId: true, label: true, style: true },
  });
}

function draw(
  canvasId: string,
  actorId: string,
  fromId: string,
  toId: string,
  extra: { label?: string; style?: "DASHED" } = {},
) {
  return prisma.$transaction((tx) =>
    createLinkArrow(tx, { canvasId, actorId, fromId, toId, ...extra }),
  );
}

function job(): OutboxJob {
  return {
    id: "job",
    type: CANVAS_LINKS_BACKFILL_JOB,
    payload: {},
    attempts: 1,
  } as unknown as OutboxJob;
}

describe("arrows are links (IMP-095)", () => {
  it("an attached arrow makes a link with its label and line style, drawn under both items", async () => {
    const { user, canvas, a, b } = await fixture();
    const { arrow, link } = await draw(canvas.id, user.id, a.id, b.id, {
      label: "then",
      style: "DASHED",
    });
    expect(link).toMatchObject({ fromId: a.id, toId: b.id, label: "then" });
    expect(link!.style).toBe("DASHED");
    expect(arrow.zIndex).toBe(4);
    expect(
      await prisma.canvasEvent.count({
        where: { canvasId: canvas.id, entityId: arrow.id },
      }),
    ).toBe(1);

    // A free-floating arrow is a drawing, not a link.
    await prisma.canvasItem.create({
      data: {
        canvasId: canvas.id,
        type: "ARROW",
        positionX: 0,
        positionY: 0,
        width: 10,
        height: 10,
        content: { startItemId: a.id },
        createdById: user.id,
      },
    });
    expect(await links(canvas.id)).toHaveLength(1);
  });

  it("follows relabels, re-attaching and trashing the arrow", async () => {
    const { user, canvas, a, b, c } = await fixture();
    const { arrow } = await draw(canvas.id, user.id, a.id, b.id);
    const content = arrow.content as Record<string, unknown>;

    await prisma.canvasItem.update({
      where: { id: arrow.id },
      data: { content: { ...content, label: "because" } },
    });
    expect(await links(canvas.id)).toEqual([
      { fromId: a.id, toId: b.id, label: "because", style: "SOLID" },
    ]);

    await prisma.canvasItem.update({
      where: { id: arrow.id },
      data: { content: { ...content, endItemId: c.id } },
    });
    expect(await links(canvas.id)).toEqual([
      { fromId: a.id, toId: c.id, label: null, style: "SOLID" },
    ]);

    await prisma.canvasItem.update({
      where: { id: arrow.id },
      data: { deletedAt: new Date() },
    });
    expect(await links(canvas.id)).toEqual([]);
    await prisma.canvasItem.update({
      where: { id: arrow.id },
      data: { deletedAt: null },
    });
    expect(await links(canvas.id)).toHaveLength(1);

    await prisma.canvasItem.delete({ where: { id: arrow.id } });
    expect(await links(canvas.id)).toEqual([]);
  });

  it("drops the link while an end is trashed or on another canvas, and brings it back", async () => {
    const { user, canvas, other, a, b } = await fixture();
    await draw(canvas.id, user.id, a.id, b.id);

    await prisma.canvasItem.update({
      where: { id: b.id },
      data: { deletedAt: new Date() },
    });
    expect(await links(canvas.id)).toEqual([]);
    await prisma.canvasItem.update({
      where: { id: b.id },
      data: { deletedAt: null },
    });
    expect(await links(canvas.id)).toHaveLength(1);

    await prisma.canvasItem.update({
      where: { id: a.id },
      data: { canvasId: other.id },
    });
    expect(await links(canvas.id)).toEqual([]);
    expect(await links(other.id)).toEqual([]);
    await prisma.canvasItem.update({
      where: { id: a.id },
      data: { canvasId: canvas.id },
    });
    expect(await links(canvas.id)).toHaveLength(1);

    // Moving and resizing never touches links.
    await prisma.canvasItem.update({
      where: { id: a.id },
      data: { positionX: 50, width: 120 },
    });
    expect(await links(canvas.id)).toHaveLength(1);
  });

  it("two arrows between the same items are one link that stays until both are gone", async () => {
    const { user, canvas, a, b } = await fixture();
    const first = await draw(canvas.id, user.id, a.id, b.id, { label: "one" });
    await draw(canvas.id, user.id, a.id, b.id, { label: "two" });
    expect(await links(canvas.id)).toEqual([
      { fromId: a.id, toId: b.id, label: "one", style: "SOLID" },
    ]);
    await prisma.canvasItem.update({
      where: { id: first.arrow.id },
      data: { deletedAt: new Date() },
    });
    expect(await links(canvas.id)).toEqual([
      { fromId: a.id, toId: b.id, label: "two", style: "SOLID" },
    ]);
  });

  it("refuses arrows to items elsewhere or to other arrows", async () => {
    const { user, canvas, other, a } = await fixture();
    const away = await prisma.canvasItem.create({
      data: {
        canvasId: other.id,
        type: "NOTE",
        positionX: 0,
        positionY: 0,
        width: 10,
        height: 10,
        content: { text: "away" },
        createdById: user.id,
      },
    });
    await expect(draw(canvas.id, user.id, a.id, away.id)).rejects.toThrow(
      "Both items must be on this canvas",
    );
    await expect(draw(canvas.id, user.id, a.id, a.id)).rejects.toThrow();
  });

  it("the backfill draws arrows for old links and removes ones it cannot draw; running twice changes nothing", async () => {
    const { canvas, a, b, c } = await fixture();
    const legacy = await prisma.itemConnection.create({
      data: {
        canvasId: canvas.id,
        fromId: a.id,
        toId: b.id,
        label: "old",
        style: "DOTTED",
      },
    });
    const broken = await prisma.itemConnection.create({
      data: { canvasId: canvas.id, fromId: b.id, toId: c.id },
    });
    await prisma.canvasItem.update({
      where: { id: c.id },
      data: { deletedAt: new Date() },
    });

    const handler = createCanvasLinksBackfillHandler(prisma);
    await handler(job());
    await handler(job());

    const arrows = await prisma.canvasItem.findMany({
      where: { canvasId: canvas.id, type: "ARROW" },
    });
    expect(arrows).toHaveLength(1);
    expect(arrows[0]!.content).toMatchObject({
      startItemId: a.id,
      endItemId: b.id,
      label: "old",
      lineStyle: "DOTTED",
    });
    const rows = await prisma.itemConnection.findMany({
      where: { canvasId: canvas.id },
    });
    expect(rows.map((row) => row.id)).toEqual([legacy.id]);
    expect(rows[0]).toMatchObject({ label: "old", style: "DOTTED" });
    expect(rows.some((row) => row.id === broken.id)).toBe(false);
  });

  it("search results, Ask and agents see what an item is linked to", async () => {
    const { user, canvas, a, b } = await fixture();
    const tag = randomBytes(4).toString("hex");
    await prisma.canvasItem.update({
      where: { id: a.id },
      data: { content: { text: `wombat${tag} plan` } },
    });
    await draw(canvas.id, user.id, a.id, b.id, { label: "then" });
    session.user = { id: user.id, email: user.email };

    const response = await search(
      new Request(`http://localhost/api/v1/search?q=wombat${tag}`),
    );
    const body = await response.json();
    expect(body.results[0].links).toEqual([
      { direction: "to", itemId: b.id, title: "note 300", label: "then" },
    ]);

    const asked = await retrieveOwnedItems(user.id, `wombat${tag}`);
    expect(asked[0]!.links).toEqual([
      { direction: "to", itemId: b.id, title: "note 300", label: "then" },
    ]);

    const detail = await getScopedItemDetail(
      { userId: user.id, agentProfile: null },
      b.id,
    );
    expect(detail.item.links).toEqual([
      expect.objectContaining({ direction: "from", itemId: a.id }),
    ]);
  });
});
