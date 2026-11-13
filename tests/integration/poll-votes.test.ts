/**
 * IMP-104: poll votes are counted on the server. Each person votes only for
 * themselves, once (or once per choice), can change it, and the owner can
 * close the poll. Runs against PostgreSQL: the unique key, the per-voter
 * lock and the cascades are the guarantees.
 */
import { randomBytes } from "crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: { id: "", email: "" } }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => session) }));
const published = vi.hoisted(() => [] as Array<[string, string]>);
vi.mock("@/lib/cache/redis-client", () => ({
  getRedisClient: () => ({
    publish: async (channel: string, message: string) => {
      published.push([channel, message]);
      return 1;
    },
  }),
}));

import { prisma } from "@/lib/db";
import {
  GET as pollRoute,
  PATCH as closeRoute,
  PUT as voteRoute,
} from "@/app/api/v1/canvas-items/[itemId]/poll/route";
import { GET as canvasPollsRoute } from "@/app/api/v1/canvases/[canvasId]/polls/route";

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(() => {
  published.length = 0;
});

async function seedUser(label: string) {
  return prisma.user.create({
    data: {
      email: `poll-${label}-${randomBytes(6).toString("hex")}@example.com`,
    },
  });
}

type User = Awaited<ReturnType<typeof seedUser>>;

async function seedPoll(owner: User, multipleChoice = false) {
  const canvas = await prisma.canvas.create({
    data: { name: "Team lunch", userId: owner.id },
  });
  const item = await prisma.canvasItem.create({
    data: {
      canvasId: canvas.id,
      type: "POLL",
      positionX: 0,
      positionY: 0,
      width: 320,
      height: 240,
      content: {
        question: "Lunch?",
        options: [
          { id: "pizza", text: "Pizza" },
          { id: "sushi", text: "Sushi" },
          { id: "salad", text: "Salad" },
        ],
        multipleChoice,
      },
      createdById: owner.id,
    },
  });
  return { canvas, item };
}

async function share(canvasId: string, user: User, role: "VIEW" | "EDIT") {
  await prisma.canvasShare.create({
    data: { canvasId, email: user.email!, recipientId: user.id, role },
  });
}

function signIn(user: User) {
  session.user = { id: user.id, email: user.email! };
}

const ctx = (itemId: string) => ({ params: Promise.resolve({ itemId }) });

function vote(itemId: string, body: unknown) {
  return voteRoute(
    new Request(`http://localhost/api/v1/canvas-items/${itemId}/poll`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
    ctx(itemId) as never,
  );
}

function close(itemId: string, closed: boolean) {
  return closeRoute(
    new Request(`http://localhost/api/v1/canvas-items/${itemId}/poll`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ closed }),
    }) as never,
    ctx(itemId) as never,
  );
}

async function result(itemId: string) {
  const response = await pollRoute(
    new Request(`http://localhost/api/v1/canvas-items/${itemId}/poll`) as never,
    ctx(itemId) as never,
  );
  return response.json();
}

describe("poll votes (IMP-104)", () => {
  it("counts one vote per person, lets them change it and withdraw it", async () => {
    const owner = await seedUser("owner");
    const viewer = await seedUser("viewer");
    const { canvas, item } = await seedPoll(owner);
    await share(canvas.id, viewer, "VIEW");

    signIn(owner);
    expect((await vote(item.id, { choiceIds: ["pizza"] })).status).toBe(200);
    signIn(viewer);
    expect((await vote(item.id, { choiceIds: ["pizza"] })).status).toBe(200);
    expect((await vote(item.id, { choiceIds: ["sushi"] })).status).toBe(200);

    const seen = await result(item.id);
    expect(seen.counts).toEqual({ pizza: 1, sushi: 1, salad: 0 });
    expect(seen.voters).toBe(2);
    expect(seen.myChoiceIds).toEqual(["sushi"]);

    expect((await vote(item.id, { choiceIds: [] })).status).toBe(200);
    expect((await result(item.id)).counts.sushi).toBe(0);

    // Open boards are told to re-read; the notice carries no tally.
    expect(published.length).toBeGreaterThan(0);
    const notice = JSON.parse(published.at(-1)![1]);
    expect(notice.payload).toEqual({ type: "poll-changed", itemId: item.id });
  });

  it("takes one choice on a single-choice poll, several on a multiple-choice one", async () => {
    const owner = await seedUser("multi");
    const single = await seedPoll(owner);
    const multi = await seedPoll(owner, true);
    signIn(owner);

    expect(
      (await vote(single.item.id, { choiceIds: ["pizza", "sushi"] })).status,
    ).toBe(400);
    expect(
      (await vote(multi.item.id, { choiceIds: ["pizza", "sushi"] })).status,
    ).toBe(200);
    expect((await result(multi.item.id)).counts).toEqual({
      pizza: 1,
      sushi: 1,
      salad: 0,
    });
    // A choice that is not in the poll is refused.
    expect((await vote(single.item.id, { choiceIds: ["cake"] })).status).toBe(
      400,
    );
  });

  it("never records a vote for someone else, or for someone without access", async () => {
    const owner = await seedUser("o2");
    const other = await seedUser("other");
    const stranger = await seedUser("stranger");
    const { canvas, item } = await seedPoll(owner);
    await share(canvas.id, other, "EDIT");

    // A hand-made body naming another voter is refused outright.
    signIn(owner);
    const forged = await vote(item.id, {
      choiceIds: ["pizza"],
      userId: other.id,
    });
    expect(forged.status).toBe(400);

    signIn(stranger);
    expect((await vote(item.id, { choiceIds: ["pizza"] })).status).toBe(403);

    expect(await prisma.pollVote.count({ where: { itemId: item.id } })).toBe(0);
  });

  it("keeps one vote when two single-choice answers race", async () => {
    const owner = await seedUser("race");
    const { item } = await seedPoll(owner);
    signIn(owner);
    const responses = await Promise.all([
      vote(item.id, { choiceIds: ["pizza"] }),
      vote(item.id, { choiceIds: ["sushi"] }),
      vote(item.id, { choiceIds: ["salad"] }),
    ]);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(
      await prisma.pollVote.count({
        where: { itemId: item.id, userId: owner.id },
      }),
    ).toBe(1);
  });

  it("lets only the owner close a poll, and a closed poll takes no votes", async () => {
    const owner = await seedUser("closer");
    const editor = await seedUser("editor");
    const { canvas, item } = await seedPoll(owner);
    await share(canvas.id, editor, "EDIT");

    signIn(editor);
    expect((await close(item.id, true)).status).toBe(403);

    signIn(owner);
    expect((await close(item.id, true)).status).toBe(200);
    signIn(editor);
    expect((await vote(item.id, { choiceIds: ["pizza"] })).status).toBe(409);
    expect((await result(item.id)).closed).toBe(true);

    signIn(owner);
    expect((await close(item.id, false)).status).toBe(200);
    signIn(editor);
    expect((await vote(item.id, { choiceIds: ["pizza"] })).status).toBe(200);
  });

  it("lists every poll of a canvas, drops removed choices, and cascades on delete", async () => {
    const owner = await seedUser("list");
    const { canvas, item } = await seedPoll(owner);
    signIn(owner);
    await vote(item.id, { choiceIds: ["salad"] });

    // The editor removes the voted choice from the shared document.
    await prisma.canvasItem.update({
      where: { id: item.id },
      data: {
        content: {
          question: "Lunch?",
          options: [
            { id: "pizza", text: "Pizza" },
            { id: "sushi", text: "Sushi" },
          ],
        },
      },
    });

    const response = await canvasPollsRoute(
      new Request(
        `http://localhost/api/v1/canvases/${canvas.id}/polls`,
      ) as never,
      { params: Promise.resolve({ canvasId: canvas.id }) } as never,
    );
    const { polls } = await response.json();
    expect(polls).toHaveLength(1);
    expect(polls[0].counts).toEqual({ pizza: 0, sushi: 0 });
    expect(polls[0].voters).toBe(0);
    expect(JSON.stringify(polls)).not.toContain(owner.id);

    await prisma.canvasItem.delete({ where: { id: item.id } });
    expect(await prisma.pollVote.count({ where: { itemId: item.id } })).toBe(0);
  });
});
