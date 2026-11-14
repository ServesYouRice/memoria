/**
 * IMP-136: GET /api/v1/canvases sorts and filters on the server, keeps the
 * old order by default, and never lists another user's canvases.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  name: string;
  userId: string;
  workspaceId: string | null;
  isTemplate: boolean;
  createdAt: Date;
  updatedAt: Date;
};
type Where = {
  userId: string;
  isTemplate: boolean;
  workspaceId?: string;
  name?: { contains: string; mode: "insensitive" };
};
type OrderBy = Array<
  Partial<Record<"name" | "updatedAt" | "createdAt", "asc" | "desc">>
>;

const db = vi.hoisted(() => ({ rows: [] as Row[] }));

function matches(row: Row, where: Where) {
  if (row.userId !== where.userId) return false;
  if (row.isTemplate !== where.isTemplate) return false;
  if (where.workspaceId && row.workspaceId !== where.workspaceId) return false;
  if (
    where.name &&
    !row.name.toLowerCase().includes(where.name.contains.toLowerCase())
  ) {
    return false;
  }
  return true;
}

function compare(a: Row, b: Row, orderBy: OrderBy) {
  for (const rule of orderBy) {
    const [field, direction] = Object.entries(rule)[0] as [
      keyof Row,
      "asc" | "desc",
    ];
    const left = a[field] as string | Date;
    const right = b[field] as string | Date;
    if (left < right) return direction === "asc" ? -1 : 1;
    if (left > right) return direction === "asc" ? 1 : -1;
  }
  return 0;
}

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  count: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    canvas: { count: mocks.count, findMany: mocks.findMany },
    workspace: { findFirst: vi.fn() },
  },
}));

import { GET } from "@/app/api/v1/canvases/route";

const day = (n: number) => new Date(Date.UTC(2026, 10, n));

async function list(query = "") {
  const response = await GET(
    new Request(`https://memoria.example/api/v1/canvases${query}`) as never,
    {} as never,
  );
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue({
    userId: "cuser000001",
    email: "u@x.com",
  });
  db.rows = [
    ["ccanvas00001", "Lisbon weekend", "cuser000001", day(1), day(5)],
    ["ccanvas00002", "garden plans", "cuser000001", day(2), day(3)],
    ["ccanvas00003", "Garage sale", "cuser000001", day(3), day(4)],
    ["ccanvas00004", "Apples", "cuser000001", day(4), day(2)],
    ["ccanvas00005", "garden secret", "cuser000002", day(5), day(9)],
  ].map(([id, name, userId, createdAt, updatedAt]) => ({
    id: id as string,
    name: name as string,
    userId: userId as string,
    workspaceId: null,
    isTemplate: false,
    createdAt: createdAt as Date,
    updatedAt: updatedAt as Date,
  }));
  mocks.count.mockImplementation(
    async ({ where }: { where: Where }) =>
      db.rows.filter((row) => matches(row, where)).length,
  );
  mocks.findMany.mockImplementation(
    async ({
      where,
      orderBy,
      take,
      skip,
    }: {
      where: Where;
      orderBy: OrderBy;
      take: number;
      skip: number;
    }) =>
      db.rows
        .filter((row) => matches(row, where))
        .sort((a, b) => compare(a, b, orderBy))
        .slice(skip, skip + take)
        .map(({ isTemplate: _isTemplate, ...row }) => ({
          ...row,
          zoomLevel: 1,
          panX: 0,
          panY: 0,
          thumbnailKey: null,
          thumbnailRevision: BigInt(0),
          isPublic: false,
        })),
  );
});

const names = (body: { canvases: Array<{ name: string }> }) =>
  body.canvases.map((canvas) => canvas.name);

describe("GET /api/v1/canvases sort and filter (IMP-136)", () => {
  it("keeps newest edit first without parameters", async () => {
    const { status, body } = await list();
    expect(status).toBe(200);
    expect(names(body)).toEqual([
      "Lisbon weekend",
      "Garage sale",
      "garden plans",
      "Apples",
    ]);
    expect(mocks.findMany.mock.calls[0][0].orderBy).toEqual([
      { updatedAt: "desc" },
    ]);
  });

  it("sorts by name A to Z", async () => {
    const { body } = await list("?sort=name");
    expect(mocks.findMany.mock.calls[0][0].orderBy).toEqual([
      { name: "asc" },
      { updatedAt: "desc" },
    ]);
    expect(names(body)).toEqual([...names(body)].sort());
  });

  it("sorts by creation, newest first", async () => {
    const { body } = await list("?sort=created");
    expect(names(body)).toEqual([
      "Apples",
      "Garage sale",
      "garden plans",
      "Lisbon weekend",
    ]);
  });

  it("filters by part of the name and counts only the matches", async () => {
    const { body } = await list("?q=%20gar%20");
    expect(names(body).sort()).toEqual(["Garage sale", "garden plans"]);
    expect(body.pagination.total).toBe(2);
    expect(mocks.count.mock.calls[0][0].where).toMatchObject({
      userId: "cuser000001",
      name: { contains: "gar", mode: "insensitive" },
    });
  });

  it("never lists another user's canvases", async () => {
    const { body } = await list("?q=garden&sort=name");
    expect(names(body)).toEqual(["garden plans"]);
    for (const call of mocks.findMany.mock.calls) {
      expect(call[0].where.userId).toBe("cuser000001");
    }
  });

  it.each(["?sort=bogus", "?q=%20%20", `?q=${"x".repeat(101)}`])(
    "refuses %s",
    async (query) => {
      const { status } = await list(query);
      expect(status).toBe(400);
      expect(mocks.findMany).not.toHaveBeenCalled();
    },
  );
});
