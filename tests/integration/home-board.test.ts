import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));

import { prisma } from "@/lib/db";
import {
  HOME_BOARD_JOB,
  acceptHomeBoardSuggestion,
  createHomeBoardProposalHandler,
  dismissHomeBoardSuggestion,
  enqueueHomeBoardProposal,
  listHomeBoardSuggestions,
  undoHomeBoardMove,
} from "@/lib/agents/home-board";
import { revertChangeSet } from "@/lib/agents/service-core";
import {
  ASK_COMMAND_SUGGESTION_KIND,
  executeAskCommandSuggestion,
  getAskAssistantProfile,
} from "@/lib/ai/ask-commands";

afterAll(async () => {
  await prisma.$disconnect();
});

const noAi = { aiAvailable: async () => false };

async function setup(options: { autoFileItems?: boolean } = {}) {
  const user = await prisma.user.create({
    data: {
      email: `home-${randomBytes(6).toString("hex")}@example.com`,
      autoFileItems: options.autoFileItems ?? false,
    },
  });
  const inbox = await prisma.canvas.create({
    data: { name: "Inbox", userId: user.id },
  });
  const rome = await prisma.canvas.create({
    data: { name: "Rome trip", userId: user.id },
  });
  const work = await prisma.canvas.create({
    data: { name: "Work", userId: user.id },
  });
  await prisma.canvasItem.createMany({
    data: [
      {
        canvasId: rome.id,
        type: "NOTE",
        positionX: 0,
        positionY: 0,
        width: 200,
        height: 200,
        content: { text: "Flights" },
        tags: ["travel", "italy"],
        createdById: user.id,
      },
      {
        canvasId: work.id,
        type: "NOTE",
        positionX: 0,
        positionY: 0,
        width: 200,
        height: 200,
        content: { text: "Standup" },
        tags: ["meeting"],
        createdById: user.id,
      },
    ],
  });
  return { user, inbox, rome, work };
}

async function saveLink(
  canvasId: string,
  userId: string,
  title: string,
  tags: string[],
) {
  return prisma.canvasItem.create({
    data: {
      canvasId,
      type: "BOOKMARK",
      positionX: 80,
      positionY: 80,
      width: 360,
      height: 120,
      content: {
        url: `https://example.com/${randomBytes(3).toString("hex")}`,
        title,
      },
      tags,
      createdById: userId,
    },
  });
}

function jobFor(itemId: string) {
  return { payload: { itemId } } as never;
}

describe("home board suggestions (PostgreSQL)", () => {
  it("enqueues a proposal only for links enriched on the Inbox", async () => {
    const { user, inbox, work } = await setup();
    const inInbox = await saveLink(inbox.id, user.id, "Tickets", ["rome"]);
    const onWork = await saveLink(work.id, user.id, "Doc", ["meeting"]);

    await prisma.$transaction(async (tx) => {
      await enqueueHomeBoardProposal(tx, {
        itemId: inInbox.id,
        canvasId: inbox.id,
        userId: user.id,
      });
      await enqueueHomeBoardProposal(tx, {
        itemId: inInbox.id,
        canvasId: inbox.id,
        userId: user.id,
      });
      await enqueueHomeBoardProposal(tx, {
        itemId: onWork.id,
        canvasId: work.id,
        userId: user.id,
      });
    });
    const jobs = await prisma.outboxJob.findMany({
      where: {
        type: HOME_BOARD_JOB,
        dedupeKey: {
          in: [inInbox.id, onWork.id].map((id) => `${HOME_BOARD_JOB}:${id}`),
        },
      },
    });
    expect(jobs.map((job) => job.payload)).toEqual([{ itemId: inInbox.id }]);
  });

  it("suggests a board from tags and names, accepts it as a change set and undoes it", async () => {
    const { user, inbox, rome } = await setup();
    const item = await saveLink(inbox.id, user.id, "Colosseum tickets", [
      "rome",
      "travel",
    ]);
    const handler = createHomeBoardProposalHandler(prisma, noAi);
    await handler(jobFor(item.id));
    await handler(jobFor(item.id));

    const rows = await prisma.homeBoardSuggestion.findMany({
      where: { itemId: item.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      targetCanvasId: rome.id,
      status: "OPEN",
    });
    expect(rows[0]!.reasons).toEqual(
      expect.arrayContaining(["board-name", "tags"]),
    );
    const suggestion = await prisma.suggestion.findUniqueOrThrow({
      where: { id: rows[0]!.suggestionId! },
    });
    expect(suggestion.status).toBe("OPEN");
    expect(suggestion.payload).toMatchObject({
      kind: "ask-command",
      command: { type: "move_items", itemIds: [item.id], boardId: rome.id },
    });

    const listed = await listHomeBoardSuggestions({
      userId: user.id,
      canvasId: inbox.id,
    });
    expect(listed.suggestions).toEqual([
      expect.objectContaining({ itemId: item.id, boardName: "Rome trip" }),
    ]);

    const accepted = await acceptHomeBoardSuggestion({
      userId: user.id,
      itemId: item.id,
    });
    const moved = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(moved.canvasId).toBe(rome.id);
    const records = await prisma.changeRecord.findMany({
      where: { changeSetId: accepted.changeSetId },
    });
    expect(records.map((record) => record.operation)).toEqual(["MOVE"]);
    expect(
      (
        await prisma.suggestion.findUniqueOrThrow({
          where: { id: suggestion.id },
        })
      ).status,
    ).toBe("EXECUTED");
    const afterAccept = await listHomeBoardSuggestions({
      userId: user.id,
      canvasId: inbox.id,
    });
    expect(afterAccept.suggestions).toEqual([]);
    expect(afterAccept.recentlyFiled).toEqual([
      expect.objectContaining({ itemId: item.id, automatic: false }),
    ]);

    await undoHomeBoardMove({ userId: user.id, itemId: item.id });
    const back = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(back.canvasId).toBe(inbox.id);
    expect(back.positionX).toBe(80);
    const changeSet = await prisma.changeSet.findUniqueOrThrow({
      where: { id: accepted.changeSetId },
    });
    expect(changeSet.status).toBe("REVERTED");

    // Back in the Inbox, the item is not proposed again.
    await handler(jobFor(item.id));
    const final = await prisma.homeBoardSuggestion.findUniqueOrThrow({
      where: { itemId: item.id },
    });
    expect(final.status).toBe("REVERTED");
    expect(
      await prisma.suggestion.count({
        where: { userId: user.id, summary: { contains: "Colosseum" } },
      }),
    ).toBe(1);
    expect(
      (await listHomeBoardSuggestions({ userId: user.id, canvasId: inbox.id }))
        .suggestions,
    ).toEqual([]);
  });

  it("a move drops the item's lines on the old board and undo restores them", async () => {
    const { user, inbox, rome } = await setup();
    const item = await saveLink(inbox.id, user.id, "Colosseum tickets", [
      "rome",
      "travel",
    ]);
    const before = await saveLink(inbox.id, user.id, "Flights", []);
    const after = await saveLink(inbox.id, user.id, "Hotel", []);
    const unrelated = await saveLink(inbox.id, user.id, "Other", []);
    const outgoing = await prisma.itemConnection.create({
      data: {
        canvasId: inbox.id,
        fromId: item.id,
        toId: after.id,
        label: "then",
        style: "DASHED",
      },
    });
    const incoming = await prisma.itemConnection.create({
      data: { canvasId: inbox.id, fromId: before.id, toId: item.id },
    });
    const kept = await prisma.itemConnection.create({
      data: { canvasId: inbox.id, fromId: before.id, toId: unrelated.id },
    });
    await createHomeBoardProposalHandler(prisma, noAi)(jobFor(item.id));
    const accepted = await acceptHomeBoardSuggestion({
      userId: user.id,
      itemId: item.id,
    });

    expect(
      (await prisma.canvasItem.findUniqueOrThrow({ where: { id: item.id } }))
        .canvasId,
    ).toBe(rome.id);
    const remaining = await prisma.itemConnection.findMany({
      where: { canvasId: inbox.id },
    });
    expect(remaining.map((connection) => connection.id)).toEqual([kept.id]);
    const records = await prisma.changeRecord.findMany({
      where: { changeSetId: accepted.changeSetId },
      orderBy: { createdAt: "desc" },
    });
    expect(records.map((r) => `${r.targetType}:${r.operation}`)).toEqual([
      "CanvasItem:MOVE",
      "ItemConnection:DELETE",
      "ItemConnection:DELETE",
    ]);
    expect(
      records
        .slice(1)
        .map((r) => r.targetId)
        .sort(),
    ).toEqual([outgoing.id, incoming.id].sort());
    // Old-board collaborators get the item's delete event.
    expect(
      await prisma.canvasEvent.count({
        where: { canvasId: inbox.id, entityId: item.id, operation: "deleted" },
      }),
    ).toBe(1);

    await undoHomeBoardMove({ userId: user.id, itemId: item.id });
    expect(
      (await prisma.canvasItem.findUniqueOrThrow({ where: { id: item.id } }))
        .canvasId,
    ).toBe(inbox.id);
    const restored = await prisma.itemConnection.findMany({
      where: { canvasId: inbox.id },
      orderBy: { id: "asc" },
    });
    expect(restored).toEqual(
      [outgoing, incoming, kept].sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  it("restores a line between two items that moved together", async () => {
    const { user, inbox, work } = await setup();
    const first = await saveLink(inbox.id, user.id, "Part one", []);
    const second = await saveLink(inbox.id, user.id, "Part two", []);
    const line = await prisma.itemConnection.create({
      data: { canvasId: inbox.id, fromId: first.id, toId: second.id },
    });
    const profile = await getAskAssistantProfile(user.id);
    const actor = { userId: user.id, agentProfileId: profile.id };

    const moved = await executeAskCommandSuggestion({
      actor,
      agentProfile: profile,
      payload: {
        kind: ASK_COMMAND_SUGGESTION_KIND,
        command: {
          type: "move_items",
          itemIds: [first.id, second.id],
          boardId: work.id,
        },
      },
      summary: "Move 2 items to Work",
    });
    expect(moved.movedItemCount).toBe(2);
    expect(await prisma.itemConnection.count({ where: { id: line.id } })).toBe(
      0,
    );

    await revertChangeSet({ actor, changeSetId: moved.changeSetId });
    expect(
      (
        await prisma.canvasItem.findMany({
          where: { id: { in: [first.id, second.id] } },
        })
      ).map((item) => item.canvasId),
    ).toEqual([inbox.id, inbox.id]);
    expect(
      await prisma.itemConnection.findUniqueOrThrow({ where: { id: line.id } }),
    ).toEqual(line);
  });

  it("a dismissed suggestion is not proposed again", async () => {
    const { user, inbox } = await setup();
    const item = await saveLink(inbox.id, user.id, "Trattoria list", [
      "rome trip",
    ]);
    const handler = createHomeBoardProposalHandler(prisma, noAi);
    await handler(jobFor(item.id));
    await dismissHomeBoardSuggestion({ userId: user.id, itemId: item.id });
    await handler(jobFor(item.id));

    const row = await prisma.homeBoardSuggestion.findUniqueOrThrow({
      where: { itemId: item.id },
    });
    expect(row.status).toBe("DISMISSED");
    expect(
      (
        await prisma.suggestion.findUniqueOrThrow({
          where: { id: row.suggestionId! },
        })
      ).status,
    ).toBe("REJECTED");
    expect(
      (await prisma.canvasItem.findUniqueOrThrow({ where: { id: item.id } }))
        .canvasId,
    ).toBe(inbox.id);
    await expect(
      acceptHomeBoardSuggestion({ userId: user.id, itemId: item.id }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("files automatically above the threshold and only when allowed", async () => {
    const { user, inbox, rome } = await setup({ autoFileItems: true });
    const confident = await saveLink(inbox.id, user.id, "Vatican tour", [
      "rome trip",
      "travel",
    ]);
    const unsure = await saveLink(inbox.id, user.id, "Some article", [
      "italy",
      "news",
      "economy",
      "politics",
    ]);
    const unrelated = await saveLink(inbox.id, user.id, "Knitting", ["yarn"]);
    const handler = createHomeBoardProposalHandler(prisma, noAi);
    for (const item of [confident, unsure, unrelated]) {
      await handler(jobFor(item.id));
    }

    const rows = new Map(
      (
        await prisma.homeBoardSuggestion.findMany({
          where: { itemId: { in: [confident.id, unsure.id, unrelated.id] } },
        })
      ).map((row) => [row.itemId, row]),
    );
    expect(rows.get(confident.id)).toMatchObject({ status: "AUTO_FILED" });
    expect(rows.get(confident.id)!.confidence).toBeGreaterThanOrEqual(0.8);
    expect(rows.get(unsure.id)).toMatchObject({ status: "OPEN" });
    expect(rows.get(unsure.id)!.confidence).toBeLessThan(0.8);
    expect(rows.has(unrelated.id)).toBe(false);
    expect(
      (
        await prisma.canvasItem.findUniqueOrThrow({
          where: { id: confident.id },
        })
      ).canvasId,
    ).toBe(rome.id);
    expect(
      (await prisma.canvasItem.findUniqueOrThrow({ where: { id: unsure.id } }))
        .canvasId,
    ).toBe(inbox.id);

    const listed = await listHomeBoardSuggestions({
      userId: user.id,
      canvasId: inbox.id,
    });
    expect(listed.recentlyFiled).toEqual([
      expect.objectContaining({ itemId: confident.id, automatic: true }),
    ]);
    await undoHomeBoardMove({ userId: user.id, itemId: confident.id });
    expect(
      (
        await prisma.canvasItem.findUniqueOrThrow({
          where: { id: confident.id },
        })
      ).canvasId,
    ).toBe(inbox.id);
  });

  it("only the Inbox owner can list or act on suggestions", async () => {
    const { user, inbox } = await setup();
    const other = await prisma.user.create({
      data: { email: `other-${randomBytes(6).toString("hex")}@example.com` },
    });
    const item = await saveLink(inbox.id, user.id, "Pantheon", ["rome trip"]);
    await createHomeBoardProposalHandler(prisma, noAi)(jobFor(item.id));

    await expect(
      listHomeBoardSuggestions({ userId: other.id, canvasId: inbox.id }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      acceptHomeBoardSuggestion({ userId: other.id, itemId: item.id }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("uses stored embeddings only when AI is available", async () => {
    const { user, inbox, work } = await setup();
    const embedding = { provider: "OPENAI", model: "text-embedding-3-small" };
    const onWork = await saveLink(work.id, user.id, "Quarterly plan", []);
    const item = await saveLink(inbox.id, user.id, "Planning memo", []);
    await prisma.itemEmbedding.createMany({
      data: [
        {
          ...embedding,
          itemId: onWork.id,
          contentHash: "a",
          vector: [1, 0, 0],
        },
        {
          ...embedding,
          itemId: item.id,
          contentHash: "b",
          vector: [0.98, 0.1, 0],
        },
      ],
    });

    await createHomeBoardProposalHandler(prisma, noAi)(jobFor(item.id));
    expect(
      await prisma.homeBoardSuggestion.count({ where: { itemId: item.id } }),
    ).toBe(0);

    await createHomeBoardProposalHandler(prisma, {
      aiAvailable: async () => true,
    })(jobFor(item.id));
    expect(
      await prisma.homeBoardSuggestion.findUniqueOrThrow({
        where: { itemId: item.id },
      }),
    ).toMatchObject({ targetCanvasId: work.id, reasons: ["similar-items"] });
  });
});
