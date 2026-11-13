/**
 * IMP-104: the poll routes check access before any write, record the vote
 * of the signed-in person only, and let only the owner close a poll.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ForbiddenError } from "@/lib/errors";
import type * as VotesModule from "@/lib/polls/votes";

const mocks = vi.hoisted(() => ({
  getCachedSession: vi.fn(),
  requireItemAccess: vi.fn(),
  requireCanvasAccess: vi.fn(),
  castPollVote: vi.fn(),
  setPollClosed: vi.fn(),
  readPollResult: vi.fn(),
  readCanvasPollResults: vi.fn(),
  publishPollChanged: vi.fn(),
}));

vi.mock("@/lib/api/session-cache", () => ({
  getCachedSession: mocks.getCachedSession,
  runWithSessionCache: (fn: () => unknown) => fn(),
}));
vi.mock("@/lib/api/auth", () => ({
  requireItemAccess: mocks.requireItemAccess,
  requireCanvasAccess: mocks.requireCanvasAccess,
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/polls/votes", async (importOriginal) => {
  const actual = await importOriginal<typeof VotesModule>();
  return {
    ...actual,
    castPollVote: mocks.castPollVote,
    setPollClosed: mocks.setPollClosed,
    readPollResult: mocks.readPollResult,
    readCanvasPollResults: mocks.readCanvasPollResults,
    publishPollChanged: mocks.publishPollChanged,
  };
});

import {
  GET as readPoll,
  PATCH as closePoll,
  PUT as votePoll,
} from "@/app/api/v1/canvas-items/[itemId]/poll/route";
import { GET as readCanvasPolls } from "@/app/api/v1/canvases/[canvasId]/polls/route";

const ctx = { params: Promise.resolve({ itemId: "item-1" }) };

function send(method: "PUT" | "PATCH", body: unknown) {
  const request = new NextRequest(
    "http://localhost/api/v1/canvas-items/item-1/poll",
    {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return method === "PUT"
    ? votePoll(request, ctx as never)
    : closePoll(request, ctx as never);
}

const result = { itemId: "item-1", counts: {}, voters: 0, myChoiceIds: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCachedSession.mockResolvedValue({
    user: { id: "voter-1", email: "v@example.com" },
  });
  mocks.requireItemAccess.mockResolvedValue("VIEW");
  mocks.castPollVote.mockResolvedValue({ canvasId: "canvas-1", result });
  mocks.setPollClosed.mockResolvedValue({ canvasId: "canvas-1", result });
  mocks.readPollResult.mockResolvedValue(result);
  mocks.readCanvasPollResults.mockResolvedValue([result]);
});

describe("poll routes (IMP-104)", () => {
  it("asks for sign-in before anything", async () => {
    mocks.getCachedSession.mockResolvedValue(null);
    expect((await send("PUT", { choiceIds: ["a"] })).status).toBe(401);
    expect(mocks.castPollVote).not.toHaveBeenCalled();
  });

  it("records the vote of the signed-in viewer and tells open boards", async () => {
    const response = await send("PUT", { choiceIds: ["a"] });
    expect(response.status).toBe(200);
    expect(mocks.requireItemAccess).toHaveBeenCalledWith(
      "item-1",
      "voter-1",
      "v@example.com",
      "VIEW",
    );
    expect(mocks.castPollVote).toHaveBeenCalledWith(expect.anything(), {
      itemId: "item-1",
      userId: "voter-1",
      choiceIds: ["a"],
    });
    expect(mocks.publishPollChanged).toHaveBeenCalledWith("canvas-1", "item-1");
  });

  it("refuses a body that names a voter, and a vote without access", async () => {
    expect(
      (await send("PUT", { choiceIds: ["a"], userId: "someone-else" })).status,
    ).toBe(400);
    mocks.requireItemAccess.mockRejectedValue(new ForbiddenError());
    expect((await send("PUT", { choiceIds: ["a"] })).status).toBe(403);
    expect(mocks.castPollVote).not.toHaveBeenCalled();
  });

  it("lets only the owner close a poll", async () => {
    mocks.requireItemAccess.mockResolvedValue("EDIT");
    expect((await send("PATCH", { closed: true })).status).toBe(403);
    expect(mocks.setPollClosed).not.toHaveBeenCalled();

    mocks.requireItemAccess.mockResolvedValue("OWNER");
    expect((await send("PATCH", { closed: true })).status).toBe(200);
    expect(mocks.setPollClosed).toHaveBeenCalledWith(expect.anything(), {
      itemId: "item-1",
      userId: "voter-1",
      closed: true,
    });
  });

  it("reads counts only with view access", async () => {
    const one = await readPoll(
      new NextRequest("http://localhost/api/v1/canvas-items/item-1/poll"),
      ctx as never,
    );
    expect(one.status).toBe(200);
    expect(one.headers.get("cache-control")).toBe("no-store");

    mocks.requireCanvasAccess.mockRejectedValue(new ForbiddenError());
    const all = await readCanvasPolls(
      new NextRequest("http://localhost/api/v1/canvases/canvas-1/polls"),
      { params: Promise.resolve({ canvasId: "canvas-1" }) } as never,
    );
    expect(all.status).toBe(403);
    expect(mocks.readCanvasPollResults).not.toHaveBeenCalled();
  });
});
