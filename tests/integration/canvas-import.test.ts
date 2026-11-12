import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

const session = vi.hoisted(() => ({ user: { id: "", email: "" } }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => session) }));

import { POST } from "@/app/api/v1/canvases/import/route";
import { toJsonCanvas } from "@/lib/canvas-formats/json-canvas";
import type { CanvasItem } from "@/types/canvas";

afterAll(async () => {
  await prisma.$disconnect();
});

async function signIn() {
  const tag = randomBytes(6).toString("hex");
  const user = await prisma.user.create({
    data: { email: `canvas-import-${tag}@example.com` },
  });
  session.user = { id: user.id, email: user.email };
  return user;
}

function upload(contents: string, fileName: string, name?: string) {
  const form = new FormData();
  form.append("file", new File([contents], fileName));
  if (name) form.append("name", name);
  return POST(
    new NextRequest("http://localhost/api/v1/canvases/import", {
      method: "POST",
      body: form,
    }),
  );
}

describe("opening canvas files (IMP-096)", () => {
  it("creates a new canvas from a .canvas file with linked items, in one go", async () => {
    const user = await signIn();
    const file = {
      nodes: [
        {
          id: "g",
          type: "group",
          x: -50,
          y: -50,
          width: 900,
          height: 400,
          label: "Trip",
        },
        {
          id: "a",
          type: "text",
          x: 0,
          y: 0,
          width: 250,
          height: 60,
          text: "Flights",
          color: "4",
        },
        {
          id: "b",
          type: "link",
          x: 400,
          y: 0,
          width: 250,
          height: 60,
          url: "https://example.com",
        },
        {
          id: "c",
          type: "file",
          x: 0,
          y: 200,
          width: 250,
          height: 60,
          file: "Notes/secret.md",
        },
      ],
      edges: [{ id: "e", fromNode: "a", toNode: "b", label: "then" }],
    };
    const response = await upload(JSON.stringify(file), "Trip.canvas");
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      name: "Trip",
      format: "json-canvas",
      itemCount: 4,
      brought: { notes: 1, links: 1, "groups and frames": 1, arrows: 1 },
      leftOut: { "files from the author's computer": 1 },
    });

    const canvas = await prisma.canvas.findUniqueOrThrow({
      where: { id: body.canvasId },
      include: { items: true },
    });
    expect(canvas.userId).toBe(user.id);
    const note = canvas.items.find((item) => item.type === "NOTE")!;
    expect(note).toMatchObject({ positionX: 0, positionY: 0, width: 250 });
    expect(note.content).toMatchObject({
      plainText: "Flights",
      color: "green",
    });
    // The arrow is a real link (IMP-095).
    const links = await prisma.itemConnection.findMany({
      where: { canvasId: canvas.id },
    });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ fromId: note.id, label: "then" });
    expect(
      await prisma.canvasEvent.count({ where: { canvasId: canvas.id } }),
    ).toBe(4);

    // Exported again, it holds the same notes, links, groups and arrows.
    const again = toJsonCanvas(canvas.items as unknown as CanvasItem[]);
    expect(again.file.nodes.map((node) => node.type).sort()).toEqual([
      "group",
      "link",
      "text",
    ]);
    expect(again.file.edges).toHaveLength(1);
  });

  it("opens an .excalidraw drawing under the chosen name", async () => {
    await signIn();
    const drawing = {
      type: "excalidraw",
      version: 2,
      elements: [
        { id: "r", type: "rectangle", x: 0, y: 0, width: 100, height: 50 },
        {
          id: "d",
          type: "freedraw",
          x: 0,
          y: 100,
          points: [
            [0, 0],
            [5, 5],
          ],
        },
      ],
    };
    const response = await upload(
      JSON.stringify(drawing),
      "sketch.excalidraw",
      "My sketch",
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      name: "My sketch",
      format: "excalidraw",
      brought: { shapes: 1, "free drawings": 1 },
    });
  });

  it("refuses files it cannot read, and creates nothing", async () => {
    const user = await signIn();
    const notJson = await upload("hello", "a.canvas");
    expect(notJson.status).toBe(400);
    const empty = await upload(
      JSON.stringify({
        nodes: [
          {
            id: "f",
            type: "file",
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            file: "/etc/passwd",
          },
        ],
      }),
      "a.canvas",
    );
    expect(empty.status).toBe(400);
    expect(await prisma.canvas.count({ where: { userId: user.id } })).toBe(0);
  });
});
