/**
 * IMP-108: a table is stored as an ordinary item row, and its cells are
 * found by the same search as notes.
 */
import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  createTable,
  setTableCell,
  tableContentSchema,
} from "@/lib/tables/table-content";

const session = vi.hoisted(() => ({ user: { id: "", email: "" } }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => session) }));

import { GET as search } from "@/app/api/v1/search/route";

afterAll(async () => {
  vi.restoreAllMocks();
  await prisma.$disconnect();
});

describe("table items (IMP-108)", () => {
  it("stores a table and finds it by a word in a cell", async () => {
    const tag = randomBytes(6).toString("hex");
    const word = `quokka${tag}`;
    const user = await prisma.user.create({
      data: { email: `table-${tag}@example.com` },
    });
    session.user = { id: user.id, email: user.email };
    const canvas = await prisma.canvas.create({
      data: { name: "Plans", userId: user.id },
    });
    let table = createTable(2, 2);
    table = setTableCell(
      table,
      table.rows[0]!.id,
      table.columns[0]!.id,
      "Task",
    );
    table = setTableCell(table, table.rows[1]!.id, table.columns[0]!.id, word);
    const content = tableContentSchema.parse(table);
    const item = await prisma.canvasItem.create({
      data: {
        canvasId: canvas.id,
        type: "TABLE",
        positionX: 0,
        positionY: 0,
        width: 240,
        height: 72,
        zIndex: 1,
        content,
        tags: [],
        createdById: user.id,
      },
    });

    const response = await search(
      new Request(`http://localhost/api/v1/search?q=${word}`),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const found = body.results.find(
      (result: { itemId: string }) => result.itemId === item.id,
    );
    expect(found).toMatchObject({ itemType: "TABLE" });
    expect(found.snippet).toContain(word);
  });
});
