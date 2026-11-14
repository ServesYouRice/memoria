/**
 * IMP-138: GET /api/v1/activities fills in the canvas name for rows stored
 * without one, only from canvases the caller can open.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type CanvasRow = {
  id: string;
  name: string;
  userId: string;
  sharedWith: string[];
};
type CanvasWhere = {
  id: { in: string[] };
  OR: [{ userId: string }, { shares: { some: { recipientId: string } } }];
};

const db = vi.hoisted(() => ({
  canvases: [] as CanvasRow[],
  activities: [] as Array<Record<string, unknown>>,
}));

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  activityFindMany: vi.fn(),
  activityCount: vi.fn(),
  canvasFindMany: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    activity: { findMany: mocks.activityFindMany, count: mocks.activityCount },
    canvas: { findMany: mocks.canvasFindMany },
  },
}));

import { GET } from "@/app/api/v1/activities/route";

function activity(
  id: string,
  canvasId: string | null,
  canvasName: string | null,
) {
  return {
    id,
    userId: "u1",
    type: "ITEM_CREATED",
    canvasId,
    canvasName,
    itemId: null,
    metadata: null,
    createdAt: new Date("2026-11-14T10:00:00Z"),
    user: { id: "u1", name: "Ana", email: "a@x.com", image: null },
  };
}

async function list() {
  const response = await GET(
    new Request("https://memoria.example/api/v1/activities") as never,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    activities: Array<{ id: string; canvasName: string | null }>;
  };
}

const nameOf = (body: Awaited<ReturnType<typeof list>>, id: string) =>
  body.activities.find((row) => row.id === id)?.canvasName;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue({ userId: "u1", email: "a@x.com" });
  db.canvases = [
    { id: "own", name: "Lisbon weekend", userId: "u1", sharedWith: [] },
    { id: "shared", name: "Team board", userId: "u2", sharedWith: ["u1"] },
    { id: "private", name: "Someone's diary", userId: "u2", sharedWith: [] },
  ];
  db.activities = [
    activity("a1", "own", null),
    activity("a2", "shared", null),
    activity("a3", "private", null),
    activity("a4", "gone", null),
    activity("a5", "own", "Old name"),
    activity("a6", null, null),
  ];
  mocks.activityFindMany.mockImplementation(async () => db.activities);
  mocks.activityCount.mockImplementation(async () => db.activities.length);
  mocks.canvasFindMany.mockImplementation(
    async ({ where }: { where: CanvasWhere }) => {
      const userId = where.OR[0].userId;
      return db.canvases
        .filter(
          (canvas) =>
            where.id.in.includes(canvas.id) &&
            (canvas.userId === userId || canvas.sharedWith.includes(userId)),
        )
        .map(({ id, name }) => ({ id, name }));
    },
  );
});

describe("GET /api/v1/activities canvas names (IMP-138)", () => {
  it("fills in the name of a canvas the caller owns or shares", async () => {
    const body = await list();
    expect(nameOf(body, "a1")).toBe("Lisbon weekend");
    expect(nameOf(body, "a2")).toBe("Team board");
  });

  it("never reveals the name of a canvas the caller cannot open", async () => {
    const body = await list();
    expect(nameOf(body, "a3")).toBeNull();
    expect(JSON.stringify(body)).not.toContain("Someone's diary");
  });

  it("leaves deleted canvases, stored names and canvas-less rows alone", async () => {
    const body = await list();
    expect(nameOf(body, "a4")).toBeNull();
    expect(nameOf(body, "a5")).toBe("Old name");
    expect(nameOf(body, "a6")).toBeNull();
  });

  it("looks the names up once, scoped to the caller, for missing ids only", async () => {
    await list();
    expect(mocks.activityFindMany.mock.calls[0][0].where).toEqual({
      userId: "u1",
    });
    expect(mocks.canvasFindMany).toHaveBeenCalledTimes(1);
    const { where } = mocks.canvasFindMany.mock.calls[0][0];
    expect(where.id.in.sort()).toEqual(["gone", "own", "private", "shared"]);
    expect(where.OR).toEqual([
      { userId: "u1" },
      { shares: { some: { recipientId: "u1" } } },
    ]);
  });

  it("skips the lookup when every row has its name", async () => {
    db.activities = [activity("a1", "own", "Lisbon weekend")];
    await list();
    expect(mocks.canvasFindMany).not.toHaveBeenCalled();
  });
});
