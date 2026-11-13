import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

const session = vi.hoisted(() => ({ user: { id: "", email: "" } }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => session) }));

import { GET as search } from "@/app/api/v1/search/route";
import { searchOwnedItems } from "@/lib/ai/ask";
import {
  PAGE_COPY_BUDGET,
  createPageCopyHandler,
  storePageCopy,
} from "@/lib/services/page-copy";
import type { OutboxJob } from "@/lib/outbox/types";

afterAll(async () => {
  await prisma.$disconnect();
});

async function fixture() {
  const tag = randomBytes(6).toString("hex");
  const user = await prisma.user.create({
    data: { email: `page-copy-${tag}@example.com` },
  });
  const canvas = await prisma.canvas.create({
    data: { name: "Reading", userId: user.id },
  });
  const link = await prisma.canvasItem.create({
    data: {
      canvasId: canvas.id,
      type: "BOOKMARK",
      positionX: 0,
      positionY: 0,
      width: 300,
      height: 100,
      content: { url: `https://news.example/${tag}`, title: "A story" },
      createdById: user.id,
    },
  });
  return { tag, user, canvas, link };
}

describe("saved page copies (IMP-094)", () => {
  it("makes words found only in the page text searchable, with an excerpt", async () => {
    const { tag, user, link } = await fixture();
    const word = `quokka${tag}`;
    await prisma.$transaction((tx) =>
      storePageCopy(tx, {
        itemId: link.id,
        userId: user.id,
        url: `https://news.example/${tag}`,
        text: `Long story. The ${word} lives on an island. More text.`,
        readAt: new Date(),
      }),
    );
    session.user = { id: user.id, email: user.email };

    const response = await search(
      new Request(`http://localhost/api/v1/search?q=${word}`),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.totalResults).toBe(1);
    expect(body.results[0].itemId).toBe(link.id);
    expect(body.results[0].snippet).toContain(`The ${word} lives on an island`);

    // Ask finds it too (stemmed full-text match on the page text).
    const rows = await searchOwnedItems(user.id, [word]);
    expect(rows.map((row) => row.id)).toEqual([link.id]);
  });

  it("caps each link and the whole account, and is deleted with the item", async () => {
    const { user, canvas, link } = await fixture();
    const big = "a".repeat(PAGE_COPY_BUDGET.maxBytesPerLink + 1000);
    await expect(
      prisma.$transaction((tx) =>
        storePageCopy(tx, {
          itemId: link.id,
          userId: user.id,
          url: "https://x.example/",
          text: big,
          readAt: new Date(),
        }),
      ),
    ).resolves.toBe("stored");
    const stored = await prisma.itemPageCopy.findUniqueOrThrow({
      where: { itemId: link.id },
    });
    expect(stored.textBytes).toBe(PAGE_COPY_BUDGET.maxBytesPerLink);

    // Pretend the account is nearly full: a second link keeps no text.
    await prisma.itemPageCopy.update({
      where: { itemId: link.id },
      data: { textBytes: PAGE_COPY_BUDGET.maxBytesPerAccount - 10 },
    });
    const second = await prisma.canvasItem.create({
      data: {
        canvasId: canvas.id,
        type: "BOOKMARK",
        positionX: 0,
        positionY: 0,
        width: 300,
        height: 100,
        content: { url: "https://y.example/" },
        createdById: user.id,
      },
    });
    await expect(
      prisma.$transaction((tx) =>
        storePageCopy(tx, {
          itemId: second.id,
          userId: user.id,
          url: "https://y.example/",
          text: "more than ten bytes of text",
          readAt: new Date(),
        }),
      ),
    ).resolves.toBe("over-budget");

    await prisma.canvasItem.delete({ where: { id: link.id } });
    await expect(
      prisma.itemPageCopy.findUnique({ where: { itemId: link.id } }),
    ).resolves.toBeNull();
  });

  it("fills in a link saved earlier, once, from the job", async () => {
    const { tag, link } = await fixture();
    const fetchPage = vi.fn(async () => ({
      ok: true as const,
      html: `<html><body><main>Kept text ${tag}</main></body></html>`,
      metadata: {},
    }));
    const handler = createPageCopyHandler(prisma, { fetchPage });
    const job = {
      id: "j",
      type: "link.page-copy",
      payload: { itemId: link.id },
      attempts: 1,
      maxAttempts: 4,
    } as OutboxJob;
    await handler(job);
    await handler(job);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    const copy = await prisma.itemPageCopy.findUniqueOrThrow({
      where: { itemId: link.id },
    });
    expect(copy.text).toBe(`Kept text ${tag}`);
    expect(copy.readAt).toBeInstanceOf(Date);
  });
});
